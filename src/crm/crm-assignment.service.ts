import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../database.module';
import {
  access,
  accessItems,
  crmDeals,
  crmPipelineActivity,
  crmPipelineUsers,
  crmPipelines,
  CrmPipelineActivityAction,
  users,
} from '../schema';
import { CrmUser } from './crm-access';
import {
  CRM_DEAL_ASSIGNMENT_METHODS,
  CRM_DISTRIBUTABLE_METHODS,
  CRM_DISTRIBUTE_CHUNK_SIZE,
  CrmDealAssignmentMethod,
} from './crm-assignment';
import { CrmService } from './crm.service';
import { logPipelineActivity } from './pipeline-activity';

export type CrmTx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];
type PipelineRow = typeof crmPipelines.$inferSelect;
type EligibleUser = { id: string; username: string; role: string };

const isSuper = (role: string) => role === 'superadmin' || role === 'superuser';

const ACTIVITY_PAGE_SIZE = 50;
type PerUser = { userId: string; username: string | null; count: number };

/** Cursor = the last group's (max(created_at), max(id)), as base64 JSON. */
function decodeActivityCursor(cursor: string): { t: string; id: number } {
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

const encodeActivityCursor = (t: string, id: number) =>
  Buffer.from(JSON.stringify({ t, id }), 'utf8').toString('base64');

/** Adds each chunk's per-user counts into one list (sorted by username). */
function mergePerUser(lists: unknown[]): PerUser[] {
  const merged = new Map<string, PerUser>();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const row of list as PerUser[]) {
      const existing = merged.get(row.userId);
      if (existing) existing.count += row.count;
      else merged.set(row.userId, { ...row });
    }
  }
  return [...merged.values()].sort((a, b) => (a.username ?? '').localeCompare(b.username ?? ''));
}

/**
 * The single deal-assignment engine. Deal creation, bulk add and
 * "distribute unassigned" all pick owners through chooseAssignees().
 *
 * Eligible owners = pipeline members ∪ pipeline creator, active, with CRM menu
 * access, ordered by user id. Super roles (superadmin/superuser) are never
 * eligible: they see every pipeline and configure assignment, but own no deals.
 */
@Injectable()
export class CrmAssignmentService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly pipelines: CrmService,
  ) {}

  // ------------------------------------------------------------- engine

  async eligibleAssignees(
    tx: CrmTx,
    pipelineId: number,
    pipelineCreatorId: string | null,
  ): Promise<EligibleUser[]> {
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

    const activeUsers = (
      await tx
        .select({ id: users.id, username: users.username, role: users.role })
        .from(users)
        .where(and(inArray(users.id, candidateIds), eq(users.status, 'active')))
        .orderBy(asc(users.id))
    ).filter(({ role }) => !isSuper(role));
    if (activeUsers.length === 0) return [];

    const [menuItem] = await tx
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
    if (!menuItem) return [];

    const regularUserIds = activeUsers.map(({ id }) => id);
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
    return activeUsers.filter(({ id }) => grantedUserIds.has(id));
  }

  async eligibleAssigneeIds(tx: CrmTx, pipelineId: number, pipelineCreatorId: string | null) {
    const eligible = await this.eligibleAssignees(tx, pipelineId, pipelineCreatorId);
    return eligible.map(({ id }) => id);
  }

  /** Deals currently owned by each of the given users in this pipeline (0 if none). */
  private async loadsFor(tx: CrmTx, pipelineId: number, userIds: string[]) {
    const loads = new Map(userIds.map((id) => [id, 0]));
    if (userIds.length === 0) return loads;
    const rows = await tx
      .select({ userId: crmDeals.assignedUserId, count: sql<number>`count(*)::int` })
      .from(crmDeals)
      .where(and(eq(crmDeals.pipelineId, pipelineId), inArray(crmDeals.assignedUserId, userIds)))
      .groupBy(crmDeals.assignedUserId);
    for (const row of rows) if (row.userId) loads.set(row.userId, row.count);
    return loads;
  }

  /**
   * Picks owners for `count` deals by the pipeline's rule. The caller must hold
   * the pipeline row lock (`FOR UPDATE`) so the round-robin cursor and the
   * rule cannot change underneath.
   *
   * @param adderId the person adding the deals (used by the `creator` rule)
   */
  async chooseAssignees(
    tx: CrmTx,
    pipeline: PipelineRow,
    adderId: string,
    count: number,
  ): Promise<(string | null)[]> {
    return this.pickOwners(
      tx,
      pipeline,
      pipeline.dealAssignmentMethod,
      pipeline.dealAssignmentUserId,
      adderId,
      count,
    );
  }

  /**
   * Owners for `count` deals by `method`. Used by the new-deal rule (via
   * chooseAssignees) and by the bulk tools, which pass their own method/user.
   * Round robin advances the pipeline's shared cursor.
   */
  private async pickOwners(
    tx: CrmTx,
    pipeline: PipelineRow,
    method: CrmDealAssignmentMethod,
    singleUserId: string | null,
    adderId: string,
    count: number,
  ): Promise<(string | null)[]> {
    if (count === 0) return [];
    const none = () => Array.from({ length: count }, () => null);
    if (method === 'manual') return none();

    const eligibleIds = await this.eligibleAssigneeIds(tx, pipeline.id, pipeline.createdBy);
    if (eligibleIds.length === 0) return none();

    if (method === 'creator') {
      const owner = eligibleIds.includes(adderId) ? adderId : null;
      return Array.from({ length: count }, () => owner);
    }

    if (method === 'round_robin') {
      const start = pipeline.roundRobinCursor % eligibleIds.length;
      const owners = Array.from(
        { length: count },
        (_v, index) => eligibleIds[(start + index) % eligibleIds.length],
      );
      const nextCursor = (start + count) % eligibleIds.length;
      await tx
        .update(crmPipelines)
        .set({ roundRobinCursor: nextCursor })
        .where(eq(crmPipelines.id, pipeline.id));
      pipeline.roundRobinCursor = nextCursor;
      return owners;
    }

    // single_user: every deal goes to the chosen user while they are eligible.
    const owner = singleUserId && eligibleIds.includes(singleUserId) ? singleUserId : null;
    return Array.from({ length: count }, () => owner);
  }

  private async usernamesFor(tx: CrmTx, userIds: string[]) {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return new Map<string, string>();
    const rows = await tx
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(inArray(users.id, ids));
    return new Map(rows.map(({ id, username }) => [id, username]));
  }

  /** Deals per owner, with usernames, for the history's per-user split. */
  private async perUser(tx: CrmTx, ownerIds: string[]): Promise<PerUser[]> {
    const counts = new Map<string, number>();
    for (const id of ownerIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    const names = await this.usernamesFor(tx, [...counts.keys()]);
    return [...counts.entries()]
      .map(([userId, count]) => ({ userId, username: names.get(userId) ?? null, count }))
      .sort((a, b) => (a.username ?? '').localeCompare(b.username ?? ''));
  }

  async lockPipeline(tx: CrmTx, pipelineId: number) {
    const [pipeline] = await tx
      .select()
      .from(crmPipelines)
      .where(eq(crmPipelines.id, pipelineId))
      .for('update');
    if (!pipeline) throw new NotFoundException('Pipeline not found.');
    return pipeline;
  }

  // ------------------------------------------------------------ overview

  private async overviewIn(tx: CrmTx, pipeline: PipelineRow) {
    const eligible = await this.eligibleAssignees(tx, pipeline.id, pipeline.createdBy);
    const eligibleIds = eligible.map(({ id }) => id);
    const loads = await this.loadsFor(tx, pipeline.id, eligibleIds);
    const [totals] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        unassigned: sql<number>`count(*) FILTER (WHERE ${crmDeals.assignedUserId} IS NULL)::int`,
      })
      .from(crmDeals)
      .where(eq(crmDeals.pipelineId, pipeline.id));
    const total = totals?.total ?? 0;
    const unassigned = totals?.unassigned ?? 0;

    const sourceRows = await tx
      .select({ source: crmDeals.assignmentSource, count: sql<number>`count(*)::int` })
      .from(crmDeals)
      .where(and(eq(crmDeals.pipelineId, pipeline.id), isNotNull(crmDeals.assignedUserId)))
      .groupBy(crmDeals.assignmentSource);
    const assignedBySource: Record<CrmDealAssignmentMethod | 'unknown', number> = {
      round_robin: 0,
      single_user: 0,
      creator: 0,
      manual: 0,
      unknown: 0,
    };
    for (const row of sourceRows) {
      const key = (CRM_DEAL_ASSIGNMENT_METHODS as readonly string[]).includes(row.source ?? '')
        ? (row.source as CrmDealAssignmentMethod)
        : 'unknown';
      assignedBySource[key] += row.count;
    }
    const singleUserId = pipeline.dealAssignmentUserId;
    const singleUser = singleUserId ? eligible.find(({ id }) => id === singleUserId) : undefined;

    // Who currently owns deals given by each bulk rule, including users who
    // have since lost eligibility, so their deals can be unassigned per user.
    const [singleOwners, roundRobinOwnerRows] = await Promise.all([
      this.ownersBySource(tx, pipeline.id, 'single_user', eligibleIds),
      this.ownersBySource(tx, pipeline.id, 'round_robin', eligibleIds),
    ]);
    // Every deal each owner holds here, however assigned (for "Unassign all").
    const ownerTotals = await this.loadsFor(tx, pipeline.id, [
      ...new Set([...singleOwners, ...roundRobinOwnerRows].map(({ userId }) => userId)),
    ]);
    const withTotals = (rows: typeof singleOwners) =>
      rows.map((row) => ({ ...row, totalDeals: ownerTotals.get(row.userId) ?? row.dealCount }));
    const singleUserOwners = withTotals(singleOwners);
    const roundRobinOwners = withTotals(roundRobinOwnerRows);

    return {
      pipelineId: pipeline.id,
      method: pipeline.dealAssignmentMethod,
      total,
      assigned: total - unassigned,
      unassigned,
      /** Assigned deals by how their current owner was assigned. */
      assignedBySource,
      users: eligible
        .map(({ id, username, role }) => ({ userId: id, username, role, dealCount: loads.get(id) ?? 0 }))
        .sort((a, b) => a.username.localeCompare(b.username)),
      /** The chosen user of the 'single_user' rule (kept only while that rule is active). */
      singleUserId,
      singleUsername: singleUser?.username ?? null,
      /** False when the chosen user lost access, CRM access or was deactivated. */
      singleUserEligible: Boolean(singleUser),
      /** Owners of deals assigned by the single-user rule, with per-user counts. */
      singleUserOwners,
      /** Owners of deals assigned by round robin, with per-user counts. */
      roundRobinOwners,
      chunkSize: CRM_DISTRIBUTE_CHUNK_SIZE,
    };
  }

  /** Per-owner counts of deals whose current owner was assigned by `source`. */
  private async ownersBySource(
    tx: CrmTx,
    pipelineId: number,
    source: CrmDealAssignmentMethod,
    eligibleIds: string[],
  ) {
    const rows = await tx
      .select({
        userId: users.id,
        username: users.username,
        dealCount: sql<number>`count(${crmDeals.id})::int`,
      })
      .from(crmDeals)
      .innerJoin(users, eq(users.id, crmDeals.assignedUserId))
      .where(and(eq(crmDeals.pipelineId, pipelineId), eq(crmDeals.assignmentSource, source)))
      .groupBy(users.id, users.username)
      .orderBy(asc(users.username));
    return rows.map((row) => ({ ...row, eligible: eligibleIds.includes(row.userId) }));
  }

  /** Rule, deal totals and per-user load for the Deal assign tab. Any viewer. */
  async getOverview(pipelineId: number, user: CrmUser) {
    await this.pipelines.getVisiblePipeline(pipelineId, user);
    return this.db.transaction(async (tx) => {
      const [pipeline] = await tx.select().from(crmPipelines).where(eq(crmPipelines.id, pipelineId));
      if (!pipeline) throw new NotFoundException('Pipeline not found.');
      return this.overviewIn(tx, pipeline);
    });
  }

  // -------------------------------------------------------------- rules

  /**
   * Saves the pipeline's rule; new deals follow it from then on.
   * Super roles only (enforced by the controller). 'single_user' needs a
   * `userId` who is an eligible member of the pipeline (`400`).
   */
  async updateRule(
    pipelineId: number,
    method: CrmDealAssignmentMethod,
    userId: string | undefined,
    user: CrmUser,
  ) {
    await this.pipelines.getVisiblePipeline(pipelineId, user);

    return this.db.transaction(async (tx) => {
      const pipeline = await this.lockPipeline(tx, pipelineId);
      let singleUserId: string | null = null;
      if (method === 'single_user') {
        if (!userId) throw new BadRequestException('Choose the user who should receive the deals.');
        const eligibleIds = await this.eligibleAssigneeIds(tx, pipeline.id, pipeline.createdBy);
        if (!eligibleIds.includes(userId)) {
          throw new BadRequestException(
            'That user must be active, have CRM access and have access to this pipeline.',
          );
        }
        singleUserId = userId;
      }
      if (pipeline.dealAssignmentMethod === method && pipeline.dealAssignmentUserId === singleUserId) {
        return this.overviewIn(tx, pipeline);
      }

      const [updated] = await tx
        .update(crmPipelines)
        .set({
          dealAssignmentMethod: method,
          dealAssignmentUserId: singleUserId,
          roundRobinCursor:
            method === 'round_robin' && pipeline.dealAssignmentMethod !== 'round_robin'
              ? 0
              : pipeline.roundRobinCursor,
          updatedAt: new Date(),
        })
        .where(eq(crmPipelines.id, pipelineId))
        .returning();

      const fromUserId = pipeline.dealAssignmentUserId;
      const names = await this.usernamesFor(
        tx,
        [fromUserId, singleUserId].filter((id): id is string => Boolean(id)),
      );
      await logPipelineActivity(tx, {
        pipelineId,
        action: 'rule_changed',
        actor: user,
        meta: {
          fromMethod: pipeline.dealAssignmentMethod,
          toMethod: method,
          ...(fromUserId ? { fromUserId, fromUsername: names.get(fromUserId) ?? null } : {}),
          ...(singleUserId ? { toUserId: singleUserId, toUsername: names.get(singleUserId) ?? null } : {}),
        },
      });
      return this.overviewIn(tx, updated);
    });
  }

  /**
   * Bulk tool: assigns up to CRM_DISTRIBUTE_CHUNK_SIZE of the pipeline's
   * unassigned deals (oldest first) by `method`, independent of the pipeline's
   * rule for new deals. round_robin shares them among eligible users;
   * single_user gives them all to `targetUserId`. The client calls it
   * repeatedly until `remaining` is 0. Super roles only (controller).
   */
  async distributeUnassigned(
    pipelineId: number,
    method: (typeof CRM_DISTRIBUTABLE_METHODS)[number],
    targetUserId: string | undefined,
    user: CrmUser,
    runId?: string,
  ) {
    await this.pipelines.getVisiblePipeline(pipelineId, user);

    return this.db.transaction(async (tx) => {
      const pipeline = await this.lockPipeline(tx, pipelineId);
      if (method === 'single_user') {
        if (!targetUserId) throw new BadRequestException('Choose the user who should receive the deals.');
        const eligibleIds = await this.eligibleAssigneeIds(tx, pipeline.id, pipeline.createdBy);
        if (!eligibleIds.includes(targetUserId)) {
          throw new BadRequestException(
            'That user must be active, have CRM access and have access to this pipeline.',
          );
        }
      }

      const batch = await tx
        .select({ id: crmDeals.id })
        .from(crmDeals)
        .where(and(eq(crmDeals.pipelineId, pipelineId), isNull(crmDeals.assignedUserId)))
        .orderBy(asc(crmDeals.createdAt), asc(crmDeals.id))
        .limit(CRM_DISTRIBUTE_CHUNK_SIZE)
        .for('update');

      const owners = await this.pickOwners(
        tx,
        pipeline,
        method,
        method === 'single_user' ? (targetUserId ?? null) : null,
        user.id,
        batch.length,
      );
      const assignments = batch
        .map(({ id }, index) => ({ dealId: id, assignedUserId: owners[index] }))
        .filter((row): row is { dealId: number; assignedUserId: string } =>
          Boolean(row.assignedUserId),
        );

      if (assignments.length > 0) {
        const values = sql.join(
          assignments.map(({ dealId, assignedUserId }) => sql`(${dealId}::int, ${assignedUserId}::uuid)`),
          sql`, `,
        );
        await tx.execute(sql`
          UPDATE crm_deals AS d
          SET assigned_user_id = v.user_id, assignment_source = ${method}, updated_at = now()
          FROM (VALUES ${values}) AS v(deal_id, user_id)
          WHERE d.id = v.deal_id AND d.pipeline_id = ${pipelineId}
        `);
      }

      const [{ remaining }] = await tx
        .select({ remaining: sql<number>`count(*)::int` })
        .from(crmDeals)
        .where(and(eq(crmDeals.pipelineId, pipelineId), isNull(crmDeals.assignedUserId)));

      if (assignments.length > 0) {
        await logPipelineActivity(tx, {
          pipelineId,
          action: 'deals_assigned',
          actor: user,
          runId,
          meta: {
            method,
            count: assignments.length,
            perUser: await this.perUser(tx, assignments.map(({ assignedUserId }) => assignedUserId)),
            remaining,
          },
        });
      }

      return { method, assignedCount: assignments.length, remaining, assignments };
    });
  }

  /**
   * Unassigns up to CRM_DISTRIBUTE_CHUNK_SIZE deals whose current owner was
   * assigned by `source` (e.g. every round robin assignment). The client
   * calls it repeatedly until `remaining` is 0. Super roles only (controller).
   */
  async unassignBySource(
    pipelineId: number,
    source: CrmDealAssignmentMethod | undefined,
    ownerId: string | undefined,
    user: CrmUser,
    runId?: string,
  ) {
    if (!source && !ownerId) throw new BadRequestException('Choose which assignments to undo.');
    await this.pipelines.getVisiblePipeline(pipelineId, user);

    return this.db.transaction(async (tx) => {
      await this.lockPipeline(tx, pipelineId);
      const bySource = and(
        eq(crmDeals.pipelineId, pipelineId),
        isNotNull(crmDeals.assignedUserId),
        source ? eq(crmDeals.assignmentSource, source) : undefined,
        ownerId ? eq(crmDeals.assignedUserId, ownerId) : undefined,
      );

      const batch = await tx
        .select({ id: crmDeals.id, ownerId: crmDeals.assignedUserId })
        .from(crmDeals)
        .where(bySource)
        .orderBy(asc(crmDeals.createdAt), asc(crmDeals.id))
        .limit(CRM_DISTRIBUTE_CHUNK_SIZE)
        .for('update');

      if (batch.length > 0) {
        await tx
          .update(crmDeals)
          .set({ assignedUserId: null, assignmentSource: null, updatedAt: new Date() })
          .where(inArray(crmDeals.id, batch.map(({ id }) => id)));
      }

      const [{ remaining }] = await tx
        .select({ remaining: sql<number>`count(*)::int` })
        .from(crmDeals)
        .where(bySource);

      if (batch.length > 0) {
        const perUser = await this.perUser(
          tx,
          batch.map((row) => row.ownerId).filter((id): id is string => Boolean(id)),
        );
        await logPipelineActivity(tx, {
          pipelineId,
          action: 'deals_unassigned',
          actor: user,
          runId,
          meta: {
            source: source ?? null,
            ...(ownerId
              ? { userId: ownerId, username: perUser.find((row) => row.userId === ownerId)?.username ?? null }
              : {}),
            count: batch.length,
            perUser,
            remaining,
          },
        });
      }

      return { source: source ?? null, userId: ownerId ?? null, unassignedCount: batch.length, remaining };
    });
  }

  // ------------------------------------------------------------ history

  /**
   * WI-1b: the pipeline's drawer history, newest first. Paged by run, not by
   * row: chunks sharing a run_id are summed into one item and a run is never
   * split across pages. Any pipeline viewer; 404 when the pipeline is invisible.
   */
  async listActivity(
    pipelineId: number,
    query: { cursor?: string; limit?: number; action?: CrmPipelineActivityAction[] },
    user: CrmUser,
  ) {
    await this.pipelines.getVisiblePipeline(pipelineId, user);
    const limit = query.limit ?? ACTIVITY_PAGE_SIZE;
    const after = query.cursor ? decodeActivityCursor(query.cursor) : null;
    const a = crmPipelineActivity;

    const scope = and(
      eq(a.pipelineId, pipelineId),
      query.action?.length ? inArray(a.action, query.action) : undefined,
    );
    const groupKey = sql<string>`COALESCE(${a.runId}::text, 'single:' || ${a.id}::text)`;
    const lastAt = sql`max(${a.createdAt})`;
    const lastId = sql<number>`max(${a.id})`;

    const groups = await this.db
      .select({ key: groupKey, lastAt: sql<string>`${lastAt}::text`, lastId })
      .from(a)
      .where(scope)
      .groupBy(groupKey)
      .having(after ? sql`(${lastAt}, ${lastId}) < (${after.t}::timestamptz, ${after.id}::int)` : undefined)
      .orderBy(desc(lastAt), desc(lastId))
      .limit(limit + 1);

    const hasMore = groups.length > limit;
    const page = groups.slice(0, limit);
    if (page.length === 0) return { items: [], nextCursor: null, hasMore: false };

    const rows = await this.db
      .select()
      .from(a)
      .where(and(scope, inArray(groupKey, page.map(({ key }) => key))))
      .orderBy(asc(a.createdAt), asc(a.id));

    const byKey = new Map<string, (typeof rows)[number][]>();
    for (const row of rows) {
      const key = row.runId ?? `single:${row.id}`;
      const list = byKey.get(key);
      if (list) list.push(row);
      else byKey.set(key, [row]);
    }

    const items = page.flatMap(({ key }) => {
      const chunks = byKey.get(key) ?? [];
      const first = chunks[0];
      const last = chunks[chunks.length - 1];
      if (!first || !last) return [];
      let meta: Record<string, unknown> = { ...last.meta };
      if (chunks.length > 1 && (last.action === 'deals_assigned' || last.action === 'deals_unassigned')) {
        meta = {
          ...meta,
          count: chunks.reduce((sum, row) => sum + (Number(row.meta.count) || 0), 0),
          perUser: mergePerUser(chunks.map((row) => row.meta.perUser)),
        };
      }
      return [
        {
          id: last.id,
          runId: last.runId,
          action: last.action,
          meta,
          actor: last.actorId || last.actorName ? { id: last.actorId, username: last.actorName } : null,
          chunkCount: chunks.length,
          startedAt: first.createdAt,
          createdAt: last.createdAt,
        },
      ];
    });

    const tail = page[page.length - 1];
    return {
      items,
      nextCursor: hasMore ? encodeActivityCursor(tail.lastAt, tail.lastId) : null,
      hasMore,
    };
  }
}
