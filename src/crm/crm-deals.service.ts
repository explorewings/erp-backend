import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { ClientsService, logClientActivity, logClientActivities } from '../clients/clients.service';
import { DRIZZLE, DrizzleDb } from '../database.module';
import {
  ClientRow,
  CrmDealRow,
  access,
  accessItems,
  clients,
  crmDeals,
  crmPipelineStages,
  users,
} from '../schema';
import { CrmUser } from './crm-access';
import { CrmAssignmentService, CrmTx } from './crm-assignment.service';
import { CrmService } from './crm.service';
import { AssignCrmDealDto } from './dto/assign-deal.dto';
import { CreateCrmDealDto } from './dto/create-deal.dto';
import { TransferCrmDealsDto } from './dto/transfer-deals.dto';
import { isUniqueViolation } from './db-errors';

const assignedUsers = alias(users, 'assigned_users');

/** Kanban page size per stage column. */
export const CRM_BOARD_PAGE_SIZE = 100;

/** Case-insensitive client name / email / phone match; `%` and `_` are literal. */
function dealSearchFilter(q?: string) {
  const term = q?.trim();
  if (!term) return undefined;
  const pattern = `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  return or(ilike(clients.name, pattern), ilike(clients.email, pattern), ilike(clients.phoneNumber, pattern));
}

/** Stage cursor = the last card's (created_at, id), as base64 JSON; full timestamp precision. */
const encodeStageCursor = (t: string, id: number) =>
  Buffer.from(JSON.stringify({ t, id }), 'utf8').toString('base64');

function decodeStageCursor(cursor: string): { t: string; id: number } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as { t?: unknown; id?: unknown };
    if (
      typeof parsed.t === 'string' &&
      /^\d{4}-\d{2}-\d{2}[ T][0-9:.]+(Z|[+-]\d{2}(:?\d{2})?)?$/.test(parsed.t) &&
      typeof parsed.id === 'number' &&
      Number.isSafeInteger(parsed.id) &&
      parsed.id > 0
    ) {
      return { t: parsed.t, id: parsed.id };
    }
  } catch {
    // fall through to the 400 below
  }
  throw new BadRequestException('Invalid cursor.');
}

/** A pipeline row locked with `FOR UPDATE` by the assignment service. */
type LockedPipeline = Awaited<ReturnType<CrmAssignmentService['lockPipeline']>>;

/** Only the client fields a deal card needs. */
const dealClientColumns = {
  id: clients.id,
  name: clients.name,
  email: clients.email,
  phoneNumber: clients.phoneNumber,
  customFields: clients.customFields,
};

type DealClient = Pick<ClientRow, 'id' | 'name' | 'email' | 'phoneNumber' | 'customFields'>;

function toDealResponse(
  deal: CrmDealRow,
  client: DealClient,
  createdByUsername?: string | null,
  assignedUserUsername?: string | null,
) {
  return {
    id: deal.id,
    pipelineId: deal.pipelineId,
    stageId: deal.stageId,
    createdBy: deal.createdBy,
    createdByUsername: createdByUsername ?? null,
    assignedUserId: deal.assignedUserId,
    assignedUserUsername: assignedUserUsername ?? null,
    createdAt: deal.createdAt,
    updatedAt: deal.updatedAt,
    client: {
      id: client.id,
      name: client.name,
      email: client.email,
      phoneNumber: client.phoneNumber,
      customFields: client.customFields,
    },
  };
}

/**
 * Deals: a client's participation in one pipeline. Every method requires
 * access to the deal's pipeline (same rule as viewing the pipeline).
 */
@Injectable()
export class CrmDealsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly pipelines: CrmService,
    private readonly clientsService: ClientsService,
    private readonly assignment: CrmAssignmentService,
  ) {}

  async listEligibleAssignees(pipelineId: number, user: CrmUser) {
    const { pipeline } = await this.pipelines.getVisiblePipeline(pipelineId, user);
    return this.db.transaction((tx) =>
      this.assignment.eligibleAssignees(tx, pipeline.id, pipeline.createdBy),
    );
  }

  async listCrmEligibleUsers() {
    const activeUsers = await this.db
      .select({ id: users.id, username: users.username, role: users.role })
      .from(users)
      .where(eq(users.status, 'active'))
      .orderBy(asc(users.username));
    if (activeUsers.length === 0) return [];

    const menuItem = await this.db
      .select({ code: accessItems.code })
      .from(accessItems)
      .where(
        and(
          eq(accessItems.code, 'menu:crm'),
          eq(accessItems.type, 'menu'),
          eq(accessItems.isActive, true),
        ),
      )
      .limit(1);
    // Super roles have full access already; they are never offered for an access list.
    if (menuItem.length === 0) return [];

    const regularUserIds = activeUsers
      .filter(({ role }) => role !== 'superadmin' && role !== 'superuser')
      .map(({ id }) => id);
    const menuGrants = regularUserIds.length
      ? await this.db
          .select({ userId: access.userId })
          .from(access)
          .where(
            and(
              inArray(access.userId, regularUserIds),
              eq(access.code, 'menu:crm'),
              eq(access.type, 'menu'),
              eq(access.allowed, true),
            ),
          )
      : [];
    const grantedUserIds = new Set(menuGrants.map(({ userId }) => userId));
    return activeUsers.filter(
      ({ id, role }) => role !== 'superadmin' && role !== 'superuser' && grantedUserIds.has(id),
    );
  }

  private async getDealClient(tx: CrmTx, clientId: number) {
    const [client] = await tx.select(dealClientColumns).from(clients).where(eq(clients.id, clientId)).limit(1);
    if (!client) throw new NotFoundException('Client not found.');
    return client;
  }

  private async getUsernames(tx: CrmTx, ...userIds: (string | null)[]) {
    const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
    if (ids.length === 0) return new Map<string, string>();
    const rows = await tx
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(inArray(users.id, ids));
    return new Map(rows.map(({ id, username }) => [id, username]));
  }

  /** Card columns: deal + client + usernames + the raw created_at text for cursors. */
  private boardSelect() {
    return this.db
      .select({
        deal: crmDeals,
        client: dealClientColumns,
        createdByUsername: users.username,
        assignedUserUsername: assignedUsers.username,
        createdAtText: sql<string>`${crmDeals.createdAt}::text`,
      })
      .from(crmDeals)
      .innerJoin(clients, eq(clients.id, crmDeals.clientId))
      .leftJoin(users, eq(users.id, crmDeals.createdBy))
      .leftJoin(assignedUsers, eq(assignedUsers.id, crmDeals.assignedUserId));
  }

  /**
   * Kanban board: the newest CRM_BOARD_PAGE_SIZE deals of every stage plus each
   * stage's true total (both filtered by `q`). Three queries regardless of size.
   */
  async listBoard(pipelineId: number, q: string | undefined, user: CrmUser) {
    await this.pipelines.getVisiblePipeline(pipelineId, user);
    const scope = and(eq(crmDeals.pipelineId, pipelineId), dealSearchFilter(q));

    const ranked = this.db
      .select({
        id: crmDeals.id,
        rank: sql<number>`row_number() over (partition by ${crmDeals.stageId} order by ${crmDeals.createdAt} desc, ${crmDeals.id} desc)`.as(
          'rank',
        ),
      })
      .from(crmDeals)
      .innerJoin(clients, eq(clients.id, crmDeals.clientId))
      .where(scope)
      .as('ranked');

    const [totals, pageIds] = await Promise.all([
      this.db
        .select({ stageId: crmDeals.stageId, total: sql<number>`count(*)::int` })
        .from(crmDeals)
        .innerJoin(clients, eq(clients.id, crmDeals.clientId))
        .where(scope)
        .groupBy(crmDeals.stageId),
      this.db.select({ id: ranked.id }).from(ranked).where(lte(ranked.rank, CRM_BOARD_PAGE_SIZE)),
    ]);

    const rows = pageIds.length
      ? await this.boardSelect()
          .where(inArray(crmDeals.id, pageIds.map(({ id }) => id)))
          .orderBy(desc(crmDeals.createdAt), desc(crmDeals.id))
      : [];

    const byStage = new Map<number, typeof rows>();
    for (const row of rows) {
      const list = byStage.get(row.deal.stageId);
      if (list) list.push(row);
      else byStage.set(row.deal.stageId, [row]);
    }
    return {
      pageSize: CRM_BOARD_PAGE_SIZE,
      stages: totals.map(({ stageId, total }) => {
        const list = byStage.get(stageId) ?? [];
        const last = list[list.length - 1];
        return {
          stageId,
          total,
          deals: list.map((row) =>
            toDealResponse(row.deal, row.client, row.createdByUsername, row.assignedUserUsername),
          ),
          nextCursor: last && total > list.length ? encodeStageCursor(last.createdAtText, last.deal.id) : null,
        };
      }),
    };
  }

  /** The next CRM_BOARD_PAGE_SIZE deals of one stage, older than `cursor`. */
  async listStageDeals(
    pipelineId: number,
    stageId: number,
    query: { cursor?: string; q?: string },
    user: CrmUser,
  ) {
    await this.pipelines.getVisiblePipeline(pipelineId, user);
    const after = query.cursor ? decodeStageCursor(query.cursor) : null;
    const rows = await this.boardSelect()
      .where(
        and(
          eq(crmDeals.pipelineId, pipelineId),
          eq(crmDeals.stageId, stageId),
          dealSearchFilter(query.q),
          after
            ? sql`(${crmDeals.createdAt}, ${crmDeals.id}) < (${after.t}::timestamptz, ${after.id}::int)`
            : undefined,
        ),
      )
      .orderBy(desc(crmDeals.createdAt), desc(crmDeals.id))
      .limit(CRM_BOARD_PAGE_SIZE + 1);

    const hasMore = rows.length > CRM_BOARD_PAGE_SIZE;
    const page = rows.slice(0, CRM_BOARD_PAGE_SIZE);
    const last = page[page.length - 1];
    return {
      stageId,
      deals: page.map((row) => toDealResponse(row.deal, row.client, row.createdByUsername, row.assignedUserUsername)),
      nextCursor: hasMore && last ? encodeStageCursor(last.createdAtText, last.deal.id) : null,
    };
  }

  /** Every deal id in the given stages of a pipeline (Deal transfer selects whole stages). */
  async listDealIdsByStages(pipelineId: number, stageIds: number[], user: CrmUser) {
    await this.pipelines.getVisiblePipeline(pipelineId, user);
    const rows = await this.db
      .select({ id: crmDeals.id })
      .from(crmDeals)
      .where(and(eq(crmDeals.pipelineId, pipelineId), inArray(crmDeals.stageId, stageIds)))
      .orderBy(asc(crmDeals.id));
    return { ids: rows.map(({ id }) => id) };
  }

  async listDeals(pipelineId: number, user: CrmUser) {
    await this.pipelines.getVisiblePipeline(pipelineId, user);

    const rows = await this.db
      .select({
        deal: crmDeals,
        client: dealClientColumns,
        createdByUsername: users.username,
        assignedUserUsername: assignedUsers.username,
      })
      .from(crmDeals)
      .innerJoin(clients, eq(clients.id, crmDeals.clientId))
      .leftJoin(users, eq(users.id, crmDeals.createdBy))
      .leftJoin(assignedUsers, eq(assignedUsers.id, crmDeals.assignedUserId))
      .where(eq(crmDeals.pipelineId, pipelineId))
      .orderBy(desc(crmDeals.createdAt), desc(crmDeals.id));

    return rows.map((row) =>
      toDealResponse(row.deal, row.client, row.createdByUsername, row.assignedUserUsername),
    );
  }

  /**
   * Creates a new client and its deal in the pipeline's first stage, in one
   * transaction: either both are saved or neither is.
   */
  async createDealWithClient(pipelineId: number, dto: CreateCrmDealDto, user: CrmUser) {
    await this.pipelines.getVisiblePipeline(pipelineId, user);
    const clientInput = this.clientsService.normalizeClientInput(dto.client);

    try {
      return await this.db.transaction(async (tx) => {
        const lockedPipeline = await this.assignment.lockPipeline(tx, pipelineId);
        const [assignedUserId] = await this.assignment.chooseAssignees(tx, lockedPipeline, user.id, 1);
        const [firstStage] = await tx
          .select({ id: crmPipelineStages.id })
          .from(crmPipelineStages)
          .where(eq(crmPipelineStages.pipelineId, pipelineId))
          .orderBy(asc(crmPipelineStages.position), asc(crmPipelineStages.id))
          .limit(1);
        if (!firstStage) throw new BadRequestException('This pipeline has no stages.');

        const [client] = await tx
          .insert(clients)
          .values({ ...clientInput, source: 'manual', createdBy: user.id })
          .returning(dealClientColumns);
        await logClientActivity(tx, {
          clientId: client.id,
          actorId: user.id,
          action: 'created',
          meta: { source: 'manual', via: 'crm', pipelineId, pipelineName: lockedPipeline.name },
        });
        const [deal] = await tx
          .insert(crmDeals)
          .values({
            clientId: client.id,
            pipelineId,
            stageId: firstStage.id,
            createdBy: user.id,
            assignedUserId,
            assignmentSource: assignedUserId ? lockedPipeline.dealAssignmentMethod : null,
          })
          .returning();

        const usernames = await this.getUsernames(tx, deal.createdBy, deal.assignedUserId);
        return toDealResponse(
          deal,
          client,
          deal.createdBy ? usernames.get(deal.createdBy) ?? null : null,
          deal.assignedUserId ? usernames.get(deal.assignedUserId) ?? null : null,
        );
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('This client is already in the pipeline.');
      }
      throw error;
    }
  }

  /** Adds existing clients to the first stage, skipping duplicates in this pipeline. */
  async addExistingClients(pipelineId: number, clientIds: number[], user: CrmUser) {
    await this.pipelines.getVisiblePipeline(pipelineId, user);
    const uniqueClientIds = [...new Set(clientIds)];

    return this.db.transaction(async (tx) => {
      const lockedPipeline = await this.assignment.lockPipeline(tx, pipelineId);
      const [firstStage] = await tx
        .select({ id: crmPipelineStages.id })
        .from(crmPipelineStages)
        .where(eq(crmPipelineStages.pipelineId, pipelineId))
        .orderBy(asc(crmPipelineStages.position), asc(crmPipelineStages.id))
        .limit(1);
      if (!firstStage) throw new BadRequestException('This pipeline has no stages.');

      const existingClients = await tx
        .select({ id: clients.id })
        .from(clients)
        .where(inArray(clients.id, uniqueClientIds));
      const existingClientIds = existingClients.map(({ id }) => id);
      if (existingClientIds.length === 0) {
        return {
          addedCount: 0,
          alreadyInPipelineCount: 0,
          missingCount: uniqueClientIds.length,
        };
      }

      const existingDeals = await tx
        .select({ clientId: crmDeals.clientId })
        .from(crmDeals)
        .where(and(eq(crmDeals.pipelineId, pipelineId), inArray(crmDeals.clientId, existingClientIds)));
      const alreadyPresent = new Set(existingDeals.map(({ clientId }) => clientId));
      const newClientIds = existingClientIds.filter((clientId) => !alreadyPresent.has(clientId));
      if (newClientIds.length === 0) {
        return {
          addedCount: 0,
          alreadyInPipelineCount: existingClientIds.length,
          missingCount: uniqueClientIds.length - existingClientIds.length,
        };
      }

      const assignedUserIds = await this.assignment.chooseAssignees(tx, lockedPipeline, user.id, newClientIds.length);
      const addedDeals = await tx
        .insert(crmDeals)
        .values(
          newClientIds.map((clientId, index) => ({
            clientId,
            pipelineId,
            stageId: firstStage.id,
            createdBy: user.id,
            assignedUserId: assignedUserIds[index],
            assignmentSource: assignedUserIds[index] ? lockedPipeline.dealAssignmentMethod : null,
          })),
        )
        .onConflictDoNothing()
        .returning({ clientId: crmDeals.clientId, assignedUserId: crmDeals.assignedUserId });

      // Record who added each client into this pipeline (client History thread)
      // in ONE statement — one insert per row slowed bulk adds down.
      await logClientActivities(
        tx,
        addedDeals.map(({ clientId }) => ({
          clientId,
          actorId: user.id,
          action: 'added_to_pipeline' as const,
          meta: { pipelineId, pipelineName: lockedPipeline.name },
        })),
      );

      return {
        addedCount: addedDeals.length,
        alreadyInPipelineCount: existingClientIds.length - addedDeals.length,
        missingCount: uniqueClientIds.length - existingClientIds.length,
      };
    });
  }

  /**
   * Bulk move or copy deals into another pipeline, in one transaction.
   *
   * Owners are cleared first: only a `round_robin` / `single_user` target rule
   * re-assigns the deals; `creator` / `manual` leave them unassigned
   * (2026-11-17 decision). Deals whose client already has a deal in the target
   * are skipped and reported. The client sends 1–100 deal ids per chunk.
   */
  async transferDeals(dto: TransferCrmDealsDto, user: CrmUser) {
    const dealIds = [...new Set(dto.dealIds)];
    const rows = await this.db
      .select({ deal: crmDeals, client: dealClientColumns })
      .from(crmDeals)
      .innerJoin(clients, eq(clients.id, crmDeals.clientId))
      .where(inArray(crmDeals.id, dealIds));

    const sourcePipelineIds = [...new Set(rows.map(({ deal }) => deal.pipelineId))];
    if (sourcePipelineIds.length > 1) {
      throw new BadRequestException('All deals must come from the same pipeline.');
    }
    // Both visibility checks at once: each is a DB round trip.
    const [{ pipeline: target }] = await Promise.all([
      this.pipelines.getVisiblePipeline(dto.targetPipelineId, user),
      ...(sourcePipelineIds.length === 1 ? [this.pipelines.getVisiblePipeline(sourcePipelineIds[0], user)] : []),
    ]);
    if (sourcePipelineIds.length === 1) {
      if (sourcePipelineIds[0] === target.id) {
        throw new BadRequestException(
          dto.mode === 'move'
            ? 'A deal cannot be moved to the pipeline it is already in.'
            : 'These deals are already in this pipeline.',
        );
      }
    }

    const clientByClientId = new Map(rows.map(({ client }) => [client.id, client]));
    const missingCount = dealIds.length - rows.length;

    try {
      return await this.db.transaction(async (tx) => {
        // Deadlock-free lock order: pipelines (ascending) → deals (ascending) → target stages.
        const lockIds = [...new Set([target.id, ...sourcePipelineIds])].sort((a, b) => a - b);
        let targetRow: LockedPipeline | null = null;
        for (const id of lockIds) {
          const row = await this.assignment.lockPipeline(tx, id);
          if (id === target.id) targetRow = row;
        }
        if (!targetRow) throw new NotFoundException('Pipeline not found.');

        const lockedDeals = rows.length
          ? await tx
              .select()
              .from(crmDeals)
              .where(
                inArray(
                  crmDeals.id,
                  rows.map(({ deal }) => deal.id),
                ),
              )
              .orderBy(asc(crmDeals.id))
              .for('update')
          : [];
        const targetStages = await tx
          .select()
          .from(crmPipelineStages)
          .where(eq(crmPipelineStages.pipelineId, target.id))
          .orderBy(asc(crmPipelineStages.position), asc(crmPipelineStages.id))
          .for('update');
        const entryStage =
          dto.targetStageId === undefined
            ? targetStages[0]
            : targetStages.find((stage) => stage.id === dto.targetStageId);
        if (!entryStage) {
          throw new BadRequestException(
            dto.targetStageId === undefined
              ? 'The target pipeline has no stages.'
              : 'That stage does not belong to the target pipeline.',
          );
        }

        const existingDeals = lockedDeals.length
          ? await tx
              .select({ clientId: crmDeals.clientId })
              .from(crmDeals)
              .where(
                and(
                  eq(crmDeals.pipelineId, target.id),
                  inArray(
                    crmDeals.clientId,
                    lockedDeals.map(({ clientId }) => clientId),
                  ),
                ),
              )
          : [];
        const alreadyThere = new Set(existingDeals.map(({ clientId }) => clientId));
        const skippedDuplicates = lockedDeals
          .filter(({ clientId }) => alreadyThere.has(clientId))
          .map(({ id, clientId }) => ({
            dealId: id,
            clientName: clientByClientId.get(clientId)?.name ?? '',
          }));
        const transferable = lockedDeals.filter(({ clientId }) => !alreadyThere.has(clientId));

        const method = targetRow.dealAssignmentMethod;
        const owners =
          (method === 'round_robin' || method === 'single_user') && transferable.length
            ? await this.assignment.chooseAssignees(tx, targetRow, user.id, transferable.length)
            : transferable.map(() => null);
        const sourceFor = (owner: string | null) => (owner ? method : null);

        const done: { deal: CrmDealRow; client: DealClient }[] = [];
        if (dto.mode === 'move' && transferable.length) {
          // One UPDATE per distinct owner (1 for manual/creator, one per user for
          // round robin), never one per deal: each statement is a DB round trip.
          const idsByOwner = new Map<string | null, number[]>();
          transferable.forEach((deal, index) => {
            const owner = owners[index] ?? null;
            const ids = idsByOwner.get(owner);
            if (ids) ids.push(deal.id);
            else idsByOwner.set(owner, [deal.id]);
          });
          const now = new Date();
          for (const [owner, ids] of idsByOwner) {
            const updated = await tx
              .update(crmDeals)
              .set({
                pipelineId: target.id,
                stageId: entryStage.id,
                assignedUserId: owner,
                assignmentSource: sourceFor(owner),
                updatedAt: now,
              })
              .where(inArray(crmDeals.id, ids))
              .returning();
            for (const deal of updated) done.push({ deal, client: clientByClientId.get(deal.clientId)! });
          }
          done.sort((a, b) => a.deal.id - b.deal.id);
        } else if (dto.mode === 'copy' && transferable.length) {
          const inserted = await tx
            .insert(crmDeals)
            .values(
              transferable.map((deal, index) => ({
                clientId: deal.clientId,
                pipelineId: target.id,
                stageId: entryStage.id,
                createdBy: user.id,
                assignedUserId: owners[index] ?? null,
                assignmentSource: sourceFor(owners[index] ?? null),
              })),
            )
            .onConflictDoNothing()
            .returning();
          for (const deal of inserted) {
            done.push({ deal, client: clientByClientId.get(deal.clientId)! });
          }
          // Same client-log action bulk add writes, so the client's History
          // thread records the copy in one statement.
          await logClientActivities(
            tx,
            done.map(({ deal }) => ({
              clientId: deal.clientId,
              actorId: user.id,
              action: 'added_to_pipeline' as const,
              meta: {
                pipelineId: target.id,
                pipelineName: target.name,
                copiedFromPipelineId: sourcePipelineIds[0] ?? null,
              },
            })),
          );
        }

        const usernames = await this.getUsernames(
          tx,
          ...done.flatMap(({ deal }) => [deal.createdBy, deal.assignedUserId]),
        );
        return {
          mode: dto.mode,
          counts: dto.mode === 'move' ? { movedCount: done.length } : { copiedCount: done.length },
          skippedDuplicates,
          missingCount,
          unassignedCount: done.filter(({ deal }) => !deal.assignedUserId).length,
          deals: done.map(({ deal, client }) =>
            toDealResponse(
              deal,
              client,
              deal.createdBy ? (usernames.get(deal.createdBy) ?? null) : null,
              deal.assignedUserId ? (usernames.get(deal.assignedUserId) ?? null) : null,
            ),
          ),
        };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'A client in this batch is already in the target pipeline. Try again.',
        );
      }
      throw error;
    }
  }

  /** Moves a deal to another stage of the same pipeline. */
  async moveDeal(dealId: number, stageId: number, user: CrmUser) {
    const [existing] = await this.db
      .select({ pipelineId: crmDeals.pipelineId })
      .from(crmDeals)
      .where(eq(crmDeals.id, dealId))
      .limit(1);
    if (!existing) throw new NotFoundException('Deal not found.');
    await this.pipelines.getVisiblePipeline(existing.pipelineId, user);

    return this.db.transaction(async (tx) => {
      const [deal] = await tx.select().from(crmDeals).where(eq(crmDeals.id, dealId)).for('update');
      if (!deal) throw new NotFoundException('Deal not found.');

      const [stage] = await tx
        .select({ id: crmPipelineStages.id })
        .from(crmPipelineStages)
        .where(and(eq(crmPipelineStages.id, stageId), eq(crmPipelineStages.pipelineId, deal.pipelineId)))
        .limit(1);
      if (!stage) throw new BadRequestException('That stage does not belong to this deal’s pipeline.');

      const [updated] =
        deal.stageId === stageId
          ? [deal]
          : await tx
              .update(crmDeals)
              .set({ stageId, updatedAt: new Date() })
              .where(eq(crmDeals.id, dealId))
              .returning();

      const client = await this.getDealClient(tx, updated.clientId);
      const usernames = await this.getUsernames(tx, updated.createdBy, updated.assignedUserId);
      return toDealResponse(
        updated,
        client,
        updated.createdBy ? usernames.get(updated.createdBy) ?? null : null,
        updated.assignedUserId ? usernames.get(updated.assignedUserId) ?? null : null,
      );
    });
  }

  async assignDeal(dealId: number, dto: AssignCrmDealDto, user: CrmUser) {
    const [existing] = await this.db
      .select({ pipelineId: crmDeals.pipelineId })
      .from(crmDeals)
      .where(eq(crmDeals.id, dealId))
      .limit(1);
    if (!existing) throw new NotFoundException('Deal not found.');
    await this.pipelines.getVisiblePipeline(existing.pipelineId, user);

    return this.db.transaction(async (tx) => {
      const pipeline = await this.assignment.lockPipeline(tx, existing.pipelineId);
      const [deal] = await tx
        .select()
        .from(crmDeals)
        .where(and(eq(crmDeals.id, dealId), eq(crmDeals.pipelineId, pipeline.id)))
        .for('update');
      if (!deal) throw new NotFoundException('Deal not found.');

      if (dto.assignedUserId !== null) {
        const eligibleIds = await this.assignment.eligibleAssigneeIds(tx, pipeline.id, pipeline.createdBy);
        if (!eligibleIds.includes(dto.assignedUserId)) {
          throw new BadRequestException('Assigned user must be active and have access to this pipeline.');
        }
      }

      const [updated] = await tx
        .update(crmDeals)
        .set({
          assignedUserId: dto.assignedUserId,
          // Picked by hand in the deal drawer.
          assignmentSource: dto.assignedUserId ? 'manual' : null,
          updatedAt: new Date(),
        })
        .where(eq(crmDeals.id, dealId))
        .returning();
      const client = await this.getDealClient(tx, updated.clientId);
      const usernames = await this.getUsernames(tx, updated.createdBy, updated.assignedUserId);
      return toDealResponse(
        updated,
        client,
        updated.createdBy ? usernames.get(updated.createdBy) ?? null : null,
        updated.assignedUserId ? usernames.get(updated.assignedUserId) ?? null : null,
      );
    });
  }

  async removeDeal(dealId: number, user: CrmUser) {
    const [existing] = await this.db
      .select({ pipelineId: crmDeals.pipelineId })
      .from(crmDeals)
      .where(eq(crmDeals.id, dealId))
      .limit(1);
    if (!existing) throw new NotFoundException('Deal not found.');
    await this.pipelines.getVisiblePipeline(existing.pipelineId, user);

    return this.db.transaction(async (tx) => {
      const pipeline = await this.assignment.lockPipeline(tx, existing.pipelineId);
      const [deleted] = await tx
        .delete(crmDeals)
        .where(and(eq(crmDeals.id, dealId), eq(crmDeals.pipelineId, pipeline.id)))
        .returning({ id: crmDeals.id });
      if (!deleted) throw new NotFoundException('Deal not found.');
      return { id: deleted.id, deleted: true };
    });
  }
}
