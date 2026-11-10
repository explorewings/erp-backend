import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
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
  crmPipelineUsers,
  crmPipelines,
  users,
} from '../schema';
import { CrmUser } from './crm-access';
import { CrmService } from './crm.service';
import { AssignCrmDealDto } from './dto/assign-deal.dto';
import { CreateCrmDealDto } from './dto/create-deal.dto';
import { isUniqueViolation } from './db-errors';

type CrmTx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];
const assignedUsers = alias(users, 'assigned_users');

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
  ) {}

  private async eligibleAssignees(
    tx: CrmTx,
    pipelineId: number,
    pipelineCreatorId: string | null,
  ) {
    const accessRows = await tx
      .select({ userId: crmPipelineUsers.userId })
      .from(crmPipelineUsers)
      .where(eq(crmPipelineUsers.pipelineId, pipelineId));
    const candidateIds = [
      ...new Set([
        ...accessRows.map(({ userId }) => userId),
        ...(pipelineCreatorId ? [pipelineCreatorId] : []),
      ]),
    ];
    if (candidateIds.length === 0) return [];

    const activeUsers = await tx
      .select({ id: users.id, username: users.username, role: users.role })
      .from(users)
      .where(and(inArray(users.id, candidateIds), eq(users.status, 'active')))
      .orderBy(asc(users.id));
    if (activeUsers.length === 0) return [];

    const menuItem = await tx
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
    if (menuItem.length === 0) {
      return activeUsers.filter(({ role }) => role === 'superadmin' || role === 'superuser');
    }

    const regularUserIds = activeUsers
      .filter(({ role }) => role !== 'superadmin' && role !== 'superuser')
      .map(({ id }) => id);
    const menuGrants = regularUserIds.length
      ? await tx
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
      ({ id, role }) =>
        role === 'superadmin' || role === 'superuser' || grantedUserIds.has(id),
    );
  }

  private async eligibleAssigneeIds(tx: CrmTx, pipelineId: number, pipelineCreatorId: string | null) {
    const eligible = await this.eligibleAssignees(tx, pipelineId, pipelineCreatorId);
    return eligible.map(({ id }) => id);
  }

  async listEligibleAssignees(pipelineId: number, user: CrmUser) {
    const { pipeline } = await this.pipelines.getVisiblePipeline(pipelineId, user);
    return this.db.transaction((tx) =>
      this.eligibleAssignees(tx, pipeline.id, pipeline.createdBy),
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
    if (menuItem.length === 0) {
      return activeUsers.filter(({ role }) => role === 'superadmin' || role === 'superuser');
    }

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
      ({ id, role }) =>
        role === 'superadmin' || role === 'superuser' || grantedUserIds.has(id),
    );
  }

  private async chooseAssignees(
    tx: CrmTx,
    pipeline: typeof crmPipelines.$inferSelect,
    dealCreatorId: string,
    dealCount: number,
  ): Promise<(string | null)[]> {
    const eligibleIds = await this.eligibleAssigneeIds(tx, pipeline.id, pipeline.createdBy);
    if (dealCount === 0) return [];
    if (eligibleIds.length === 0) return Array.from({ length: dealCount }, () => null);

    if (pipeline.dealAssignmentMethod === 'creator_manual') {
      const assignee = eligibleIds.includes(dealCreatorId) ? dealCreatorId : null;
      return Array.from({ length: dealCount }, () => assignee);
    }

    if (pipeline.dealAssignmentMethod === 'round_robin') {
      const start = pipeline.roundRobinCursor % eligibleIds.length;
      const assignees = Array.from(
        { length: dealCount },
        (_value, index) => eligibleIds[(start + index) % eligibleIds.length],
      );
      await tx
        .update(crmPipelines)
        .set({ roundRobinCursor: (start + dealCount) % eligibleIds.length })
        .where(eq(crmPipelines.id, pipeline.id));
      return assignees;
    }

    const loadRows = await tx
      .select({
        assignedUserId: crmDeals.assignedUserId,
        count: sql<number>`count(*)::int`,
      })
      .from(crmDeals)
      .where(and(eq(crmDeals.pipelineId, pipeline.id), inArray(crmDeals.assignedUserId, eligibleIds)))
      .groupBy(crmDeals.assignedUserId);
    const loads = new Map(eligibleIds.map((id) => [id, 0]));
    for (const row of loadRows) {
      if (row.assignedUserId) loads.set(row.assignedUserId, row.count);
    }

    return Array.from({ length: dealCount }, () => {
      const assignee = eligibleIds.reduce((leastLoaded, candidate) =>
        (loads.get(candidate) ?? 0) < (loads.get(leastLoaded) ?? 0) ? candidate : leastLoaded,
      );
      loads.set(assignee, (loads.get(assignee) ?? 0) + 1);
      return assignee;
    });
  }

  private async lockPipeline(tx: CrmTx, pipelineId: number) {
    const [pipeline] = await tx
      .select()
      .from(crmPipelines)
      .where(eq(crmPipelines.id, pipelineId))
      .for('update');
    if (!pipeline) throw new NotFoundException('Pipeline not found.');
    return pipeline;
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
        const lockedPipeline = await this.lockPipeline(tx, pipelineId);
        const [assignedUserId] = await this.chooseAssignees(tx, lockedPipeline, user.id, 1);
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
      const lockedPipeline = await this.lockPipeline(tx, pipelineId);
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

      const assignedUserIds = await this.chooseAssignees(tx, lockedPipeline, user.id, newClientIds.length);
      const addedDeals = await tx
        .insert(crmDeals)
        .values(
          newClientIds.map((clientId, index) => ({
            clientId,
            pipelineId,
            stageId: firstStage.id,
            createdBy: user.id,
            assignedUserId: assignedUserIds[index],
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
      const pipeline = await this.lockPipeline(tx, existing.pipelineId);
      const [deal] = await tx
        .select()
        .from(crmDeals)
        .where(and(eq(crmDeals.id, dealId), eq(crmDeals.pipelineId, pipeline.id)))
        .for('update');
      if (!deal) throw new NotFoundException('Deal not found.');

      if (dto.assignedUserId !== null) {
        const eligibleIds = await this.eligibleAssigneeIds(tx, pipeline.id, pipeline.createdBy);
        if (!eligibleIds.includes(dto.assignedUserId)) {
          throw new BadRequestException('Assigned user must be active and have access to this pipeline.');
        }
      }

      const [updated] = await tx
        .update(crmDeals)
        .set({ assignedUserId: dto.assignedUserId, updatedAt: new Date() })
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
      const pipeline = await this.lockPipeline(tx, existing.pipelineId);
      const [deleted] = await tx
        .delete(crmDeals)
        .where(and(eq(crmDeals.id, dealId), eq(crmDeals.pipelineId, pipeline.id)))
        .returning({ id: crmDeals.id });
      if (!deleted) throw new NotFoundException('Deal not found.');
      return { id: deleted.id, deleted: true };
    });
  }
}
