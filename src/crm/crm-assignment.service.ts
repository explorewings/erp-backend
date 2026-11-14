import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../database.module';
import { access, accessItems, crmDeals, crmPipelineUsers, crmPipelines, users } from '../schema';
import { CrmUser } from './crm-access';
import {
  CRM_DEAL_ASSIGNMENT_METHODS,
  CRM_DISTRIBUTABLE_METHODS,
  CRM_DISTRIBUTE_CHUNK_SIZE,
  CrmDealAssignmentMethod,
} from './crm-assignment';
import { CrmService } from './crm.service';

export type CrmTx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];
type PipelineRow = typeof crmPipelines.$inferSelect;
type EligibleUser = { id: string; username: string; role: string };

const isSuper = (role: string) => role === 'superadmin' || role === 'superuser';

const RULE_NAMES: Record<CrmDealAssignmentMethod, string> = {
  round_robin: 'round robin',
  single_user: 'single user',
  creator: 'creator',
  manual: 'manual',
};

/**
 * The single deal-assignment engine. Deal creation, bulk add and
 * "distribute unassigned" all pick owners through chooseAssignees().
 *
 * Eligible owners = pipeline members ∪ pipeline creator, active, with CRM menu
 * access (super roles always pass), ordered by user id.
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

    const activeUsers = await tx
      .select({ id: users.id, username: users.username, role: users.role })
      .from(users)
      .where(and(inArray(users.id, candidateIds), eq(users.status, 'active')))
      .orderBy(asc(users.id));
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
    if (!menuItem) return activeUsers.filter(({ role }) => isSuper(role));

    const regularUserIds = activeUsers.filter(({ role }) => !isSuper(role)).map(({ id }) => id);
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
    return activeUsers.filter(({ id, role }) => isSuper(role) || grantedUserIds.has(id));
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
    if (count === 0) return [];
    const none = () => Array.from({ length: count }, () => null);
    const method = pipeline.dealAssignmentMethod;
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
    const owner =
      pipeline.dealAssignmentUserId && eligibleIds.includes(pipeline.dealAssignmentUserId)
        ? pipeline.dealAssignmentUserId
        : null;
    return Array.from({ length: count }, () => owner);
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
    const [singleUserOwners, roundRobinOwners] = await Promise.all([
      this.ownersBySource(tx, pipeline.id, 'single_user', eligibleIds),
      this.ownersBySource(tx, pipeline.id, 'round_robin', eligibleIds),
    ]);

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

      // One bulk rule at a time: while deals given by round robin or single
      // user exist, switching to another rule is refused until they are reverted.
      if (method !== pipeline.dealAssignmentMethod) {
        const blocking = CRM_DISTRIBUTABLE_METHODS.filter((source) => source !== method);
        const [blocker] = await tx
          .select({ source: crmDeals.assignmentSource, count: sql<number>`count(*)::int` })
          .from(crmDeals)
          .where(
            and(
              eq(crmDeals.pipelineId, pipeline.id),
              isNotNull(crmDeals.assignedUserId),
              inArray(crmDeals.assignmentSource, [...blocking]),
            ),
          )
          .groupBy(crmDeals.assignmentSource)
          .limit(1);
        if (blocker) {
          const name = RULE_NAMES[blocker.source as CrmDealAssignmentMethod] ?? blocker.source;
          throw new ConflictException(
            `Revert ${name} first: ${blocker.count} deal${blocker.count === 1 ? ' was' : 's were'} assigned by it in this pipeline.`,
          );
        }
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
      return this.overviewIn(tx, updated);
    });
  }

  /**
   * Assigns up to CRM_DISTRIBUTE_CHUNK_SIZE of the pipeline's unassigned deals
   * (oldest first) by its saved rule. The client calls it repeatedly until
   * `remaining` is 0, showing progress. Super roles only (controller).
   */
  async distributeUnassigned(pipelineId: number, user: CrmUser) {
    await this.pipelines.getVisiblePipeline(pipelineId, user);

    return this.db.transaction(async (tx) => {
      const pipeline = await this.lockPipeline(tx, pipelineId);
      const method = pipeline.dealAssignmentMethod;
      if (!(CRM_DISTRIBUTABLE_METHODS as readonly string[]).includes(method)) {
        throw new BadRequestException(
          'Only round robin and single user can assign existing deals. Choose one of them first.',
        );
      }

      const batch = await tx
        .select({ id: crmDeals.id })
        .from(crmDeals)
        .where(and(eq(crmDeals.pipelineId, pipelineId), isNull(crmDeals.assignedUserId)))
        .orderBy(asc(crmDeals.createdAt), asc(crmDeals.id))
        .limit(CRM_DISTRIBUTE_CHUNK_SIZE)
        .for('update');

      const owners = await this.chooseAssignees(tx, pipeline, user.id, batch.length);
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
    source: CrmDealAssignmentMethod,
    ownerId: string | undefined,
    user: CrmUser,
  ) {
    await this.pipelines.getVisiblePipeline(pipelineId, user);

    return this.db.transaction(async (tx) => {
      await this.lockPipeline(tx, pipelineId);
      const bySource = and(
        eq(crmDeals.pipelineId, pipelineId),
        isNotNull(crmDeals.assignedUserId),
        eq(crmDeals.assignmentSource, source),
        ownerId ? eq(crmDeals.assignedUserId, ownerId) : undefined,
      );

      const batch = await tx
        .select({ id: crmDeals.id })
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

      return { source, userId: ownerId ?? null, unassignedCount: batch.length, remaining };
    });
  }
}
