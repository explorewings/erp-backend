import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../database.module';
import {
  CrmPipelineRow,
  CrmPipelineStageRow,
  crmDeals,
  crmPipelineStages,
  crmPipelines,
  crmPipelineUsers,
  users,
} from '../schema';
import {
  canManagePipeline,
  canManagePipelineUsers,
  canViewPipeline,
  CrmUser,
  isSuperRole,
} from './crm-access';
import { CreateCrmPipelineDto } from './dto/create-pipeline.dto';
import { isUniqueViolation } from './db-errors';
import type { CrmTx } from './crm-assignment.service';

function toStageResponse(stage: CrmPipelineStageRow) {
  return {
    id: stage.id,
    pipelineId: stage.pipelineId,
    name: stage.name,
    position: stage.position,
    createdAt: stage.createdAt,
    updatedAt: stage.updatedAt,
  };
}

function toPipelineResponse(
  pipeline: CrmPipelineRow,
  stages: CrmPipelineStageRow[],
  allowedUserIds: string[],
  canManage: boolean,
  dealCount = 0,
) {
  return {
    id: pipeline.id,
    name: pipeline.name,
    position: pipeline.position,
    dealAssignmentMethod: pipeline.dealAssignmentMethod,
    dealCount,
    createdAt: pipeline.createdAt,
    updatedAt: pipeline.updatedAt,
    createdBy: pipeline.createdBy,
    allowedUserIds,
    canManage,
    stages: [...stages]
      .sort((a, b) => a.position - b.position || a.id - b.id)
      .map(toStageResponse),
  };
}

/** Stage names are unique per pipeline, compared case-insensitively. */
const nameKey = (name: string) => name.toLocaleLowerCase();

function groupBy<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = groups.get(k);
    if (list) list.push(row);
    else groups.set(k, [row]);
  }
  return groups;
}

@Injectable()
export class CrmService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  // ---------------------------------------------------------------- access

  /** IDs of the pipelines the user has been granted access to. */
  private async grantedPipelineIds(user: CrmUser): Promise<Set<number>> {
    if (isSuperRole(user.role)) return new Set();
    const rows = await this.db
      .select({ pipelineId: crmPipelineUsers.pipelineId })
      .from(crmPipelineUsers)
      .where(eq(crmPipelineUsers.userId, user.id));
    return new Set(rows.map((row) => row.pipelineId));
  }

  /**
   * Loads a pipeline the user may see. Pipelines the user cannot see are
   * reported as not found so their existence is not leaked.
   * Shared with CrmDealsService so deals follow the same access rule.
   */
  async getVisiblePipeline(pipelineId: number, user: CrmUser) {
    const [pipeline] = await this.db
      .select()
      .from(crmPipelines)
      .where(eq(crmPipelines.id, pipelineId))
      .limit(1);
    if (!pipeline) throw new NotFoundException('Pipeline not found.');

    let hasGrant = false;
    if (!isSuperRole(user.role)) {
      const [grant] = await this.db
        .select({ pipelineId: crmPipelineUsers.pipelineId })
        .from(crmPipelineUsers)
        .where(
          and(eq(crmPipelineUsers.pipelineId, pipelineId), eq(crmPipelineUsers.userId, user.id)),
        )
        .limit(1);
      hasGrant = Boolean(grant);
    }

    if (!canViewPipeline(user, pipeline, hasGrant)) {
      throw new NotFoundException('Pipeline not found.');
    }
    return { pipeline, canManage: canManagePipeline(user, pipeline, hasGrant) };
  }

  /** Like getVisiblePipeline, but also requires rename/delete permission. */
  private async getManageablePipeline(pipelineId: number, user: CrmUser) {
    const { pipeline, canManage } = await this.getVisiblePipeline(pipelineId, user);
    if (!canManage) {
      throw new ForbiddenException('You do not have permission to change this pipeline.');
    }
    return pipeline;
  }

  // ------------------------------------------------------------- pipelines

  async listPipelines(user: CrmUser) {
    const grantedIds = await this.grantedPipelineIds(user);
    const allPipelines = await this.db
      .select()
      .from(crmPipelines)
      .orderBy(asc(crmPipelines.position), asc(crmPipelines.id));

    const visible = allPipelines.filter((pipeline) =>
      canViewPipeline(user, pipeline, grantedIds.has(pipeline.id)),
    );
    if (visible.length === 0) return [];

    const visibleIds = visible.map((pipeline) => pipeline.id);
    const [stageRows, accessRows, dealCountRows] = await Promise.all([
      this.db
        .select()
        .from(crmPipelineStages)
        .where(inArray(crmPipelineStages.pipelineId, visibleIds)),
      this.db
        .select({ pipelineId: crmPipelineUsers.pipelineId, userId: crmPipelineUsers.userId })
        .from(crmPipelineUsers)
        .where(inArray(crmPipelineUsers.pipelineId, visibleIds)),
      this.db
        .select({
          pipelineId: crmDeals.pipelineId,
          count: sql<number>`count(*)::int`,
        })
        .from(crmDeals)
        .where(inArray(crmDeals.pipelineId, visibleIds))
        .groupBy(crmDeals.pipelineId),
    ]);

    const stagesByPipeline = groupBy(stageRows, (stage) => stage.pipelineId);
    const accessByPipeline = groupBy(accessRows, (access) => access.pipelineId);
    const dealCountsByPipeline = new Map(
      dealCountRows.map(({ pipelineId, count }) => [pipelineId, count]),
    );

    return visible.map((pipeline) =>
      toPipelineResponse(
        pipeline,
        stagesByPipeline.get(pipeline.id) ?? [],
        (accessByPipeline.get(pipeline.id) ?? []).map((access) => access.userId),
        canManagePipeline(user, pipeline, grantedIds.has(pipeline.id)),
        dealCountsByPipeline.get(pipeline.id) ?? 0,
      ),
    );
  }

  async createPipeline(dto: CreateCrmPipelineDto, user: CrmUser) {
    const name = dto.name.trim();
    const stages = dto.stages.map((stage) => stage.trim()).filter(Boolean);
    if (!name) throw new BadRequestException('Pipeline name is required.');
    if (stages.length === 0) throw new BadRequestException('At least one stage is required.');

    const seen = new Set<string>();
    for (const stage of stages) {
      if (seen.has(nameKey(stage))) {
        throw new BadRequestException(`Duplicate stage name: "${stage}".`);
      }
      seen.add(nameKey(stage));
    }

    // The creator always has access. Reject unknown or inactive users up front
    // instead of surfacing a foreign-key violation as a 500.
    const allowedUserIds = [...new Set([user.id, ...(dto.allowedUserIds ?? [])])];
    const activeUsers = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, allowedUserIds), ne(users.status, 'inactive')));
    const activeIds = new Set(activeUsers.map((row) => row.id));
    if (allowedUserIds.some((id) => id !== user.id && !activeIds.has(id))) {
      throw new BadRequestException('One or more selected users do not exist or are inactive.');
    }

    try {
      return await this.db.transaction(async (tx) => {
        // Append after existing pipelines so the selector order is stable.
        const [{ nextPosition }] = await tx
          .select({
            nextPosition: sql<number>`COALESCE(MAX(${crmPipelines.position}) + 1, 0)::int`,
          })
          .from(crmPipelines);

        const [pipeline] = await tx
          .insert(crmPipelines)
          .values({ name, position: nextPosition, createdBy: user.id })
          .returning();
        if (!pipeline) throw new InternalServerErrorException('Unable to create pipeline.');

        const createdStages = await tx
          .insert(crmPipelineStages)
          .values(
            stages.map((stage, index) => ({
              pipelineId: pipeline.id,
              name: stage,
              position: index,
            })),
          )
          .returning();

        await tx
          .insert(crmPipelineUsers)
          .values(allowedUserIds.map((userId) => ({ pipelineId: pipeline.id, userId })))
          .onConflictDoNothing();

        return toPipelineResponse(pipeline, createdStages, allowedUserIds, true);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('A stage with this name already exists in the pipeline.');
      }
      throw error;
    }
  }

  async renamePipeline(pipelineId: number, rawName: string, user: CrmUser) {
    const name = rawName.trim();
    if (!name) throw new BadRequestException('Pipeline name is required.');

    const pipeline = await this.getManageablePipeline(pipelineId, user);
    if (pipeline.name === name) {
      return { id: pipeline.id, name: pipeline.name, updatedAt: pipeline.updatedAt };
    }

    const [updated] = await this.db
      .update(crmPipelines)
      .set({ name, updatedAt: new Date() })
      .where(eq(crmPipelines.id, pipelineId))
      .returning({
        id: crmPipelines.id,
        name: crmPipelines.name,
        updatedAt: crmPipelines.updatedAt,
      });
    if (!updated) throw new NotFoundException('Pipeline not found.');
    return updated;
  }

  // --------------------------------------------------------- pipeline users

  /** The pipeline's access rows joined with user identity, for the Assign users drawer. */
  async listPipelineUsers(pipelineId: number, user: CrmUser) {
    const { pipeline } = await this.getVisiblePipeline(pipelineId, user);
    return this.db
      .select({
        id: users.id,
        username: users.username,
        role: users.role,
        status: users.status,
      })
      .from(crmPipelineUsers)
      .innerJoin(users, eq(users.id, crmPipelineUsers.userId))
      .where(eq(crmPipelineUsers.pipelineId, pipeline.id))
      .orderBy(asc(users.username));
  }

  /**
   * Compares the desired member list with the current one: who is added, who
   * is removed, how many deals each removed user owns, and whether the
   * single-user rule target is among them. The creator is always kept.
   */
  private async planMembership(
    tx: CrmTx,
    pipeline: { id: number; createdBy: string | null },
    rawUserIds: string[],
  ) {
    const desired = new Set(rawUserIds);
    if (pipeline.createdBy) desired.add(pipeline.createdBy);

    const currentRows = await tx
      .select({ userId: crmPipelineUsers.userId })
      .from(crmPipelineUsers)
      .where(eq(crmPipelineUsers.pipelineId, pipeline.id));
    const current = new Set(currentRows.map((row) => row.userId));

    const addedIds = [...desired].filter((id) => !current.has(id));
    const removedIds = [...current].filter((id) => !desired.has(id));

    const added = addedIds.length
      ? await tx
          .select({ id: users.id, username: users.username, role: users.role, status: users.status })
          .from(users)
          .where(inArray(users.id, addedIds))
      : [];
    const inactiveOrMissing = addedIds.filter(
      (id) => !added.some((row) => row.id === id && row.status !== 'inactive'),
    );
    if (inactiveOrMissing.length > 0) {
      throw new BadRequestException('One or more users do not exist or are inactive.');
    }

    let removed: { userId: string; username: string | null; dealCount: number }[] = [];
    if (removedIds.length > 0) {
      const [people, counts] = await Promise.all([
        tx
          .select({ userId: users.id, username: users.username })
          .from(users)
          .where(inArray(users.id, removedIds))
          .orderBy(asc(users.username)),
        tx
          .select({ userId: crmDeals.assignedUserId, count: sql<number>`count(*)::int` })
          .from(crmDeals)
          .where(and(eq(crmDeals.pipelineId, pipeline.id), inArray(crmDeals.assignedUserId, removedIds)))
          .groupBy(crmDeals.assignedUserId),
      ]);
      const countByUser = new Map(counts.map((row) => [row.userId, row.count]));
      removed = people.map((person) => ({ ...person, dealCount: countByUser.get(person.userId) ?? 0 }));
    }

    return { desired: [...desired], added, removedIds, removed };
  }

  /** What saving this member list would do — shown in the confirmation before saving. */
  async previewPipelineUsers(pipelineId: number, userIds: string[], user: CrmUser) {
    if (!canManagePipelineUsers(user)) {
      throw new ForbiddenException('Only a superadmin can change pipeline access.');
    }
    const { pipeline } = await this.getVisiblePipeline(pipelineId, user);
    const [rule] = await this.db
      .select({ method: crmPipelines.dealAssignmentMethod, singleUserId: crmPipelines.dealAssignmentUserId })
      .from(crmPipelines)
      .where(eq(crmPipelines.id, pipeline.id));

    const plan = await this.db.transaction((tx) => this.planMembership(tx, pipeline, userIds));
    const singleUserRemoved =
      rule?.method === 'single_user' && rule.singleUserId
        ? (plan.removed.find((row) => row.userId === rule.singleUserId) ?? null)
        : null;
    return {
      added: plan.added.map(({ id, username, role }) => ({ userId: id, username, role })),
      removed: plan.removed,
      dealsToUnassign: plan.removed.reduce((sum, row) => sum + row.dealCount, 0),
      singleUserRemoved: singleUserRemoved
        ? { userId: singleUserRemoved.userId, username: singleUserRemoved.username }
        : null,
    };
  }

  /**
   * Replaces the pipeline's member list in one transaction. Deals owned by
   * removed users are unassigned (requires `confirmUnassign`), and if the
   * single-user target is removed the rule falls back to `manual`.
   */
  async savePipelineUsers(
    pipelineId: number,
    userIds: string[],
    confirmUnassign: boolean,
    user: CrmUser,
  ) {
    if (!canManagePipelineUsers(user)) {
      throw new ForbiddenException('Only a superadmin can change pipeline access.');
    }
    const { pipeline } = await this.getVisiblePipeline(pipelineId, user);

    const result = await this.db.transaction(async (tx) => {
      // Same lock as deal assignment, so no deal can be given to a user
      // while they are being removed.
      const [locked] = await tx
        .select({
          method: crmPipelines.dealAssignmentMethod,
          singleUserId: crmPipelines.dealAssignmentUserId,
        })
        .from(crmPipelines)
        .where(eq(crmPipelines.id, pipeline.id))
        .for('update');
      if (!locked) throw new NotFoundException('Pipeline not found.');

      const plan = await this.planMembership(tx, pipeline, userIds);
      const dealsToUnassign = plan.removed.reduce((sum, row) => sum + row.dealCount, 0);
      if (dealsToUnassign > 0 && !confirmUnassign) {
        throw new ConflictException(
          `The removed users own ${dealsToUnassign} deal${dealsToUnassign === 1 ? '' : 's'}. Confirm to unassign them.`,
        );
      }

      let unassignedCount = 0;
      let ruleChangedTo: string | null = null;
      if (plan.removedIds.length > 0) {
        // Unassign first: the composite FK to crm_pipeline_users is RESTRICT.
        const cleared = await tx
          .update(crmDeals)
          .set({ assignedUserId: null, assignmentSource: null, updatedAt: new Date() })
          .where(and(eq(crmDeals.pipelineId, pipeline.id), inArray(crmDeals.assignedUserId, plan.removedIds)))
          .returning({ id: crmDeals.id });
        unassignedCount = cleared.length;

        if (locked.method === 'single_user' && locked.singleUserId && plan.removedIds.includes(locked.singleUserId)) {
          await tx
            .update(crmPipelines)
            .set({ dealAssignmentMethod: 'manual', dealAssignmentUserId: null, updatedAt: new Date() })
            .where(eq(crmPipelines.id, pipeline.id));
          ruleChangedTo = 'manual';
        }

        await tx
          .delete(crmPipelineUsers)
          .where(and(eq(crmPipelineUsers.pipelineId, pipeline.id), inArray(crmPipelineUsers.userId, plan.removedIds)));
      }

      if (plan.added.length > 0) {
        await tx
          .insert(crmPipelineUsers)
          .values(plan.added.map((row) => ({ pipelineId: pipeline.id, userId: row.id })))
          .onConflictDoNothing();
      }

      return {
        addedCount: plan.added.length,
        removedCount: plan.removedIds.length,
        unassignedCount,
        ruleChangedTo,
      };
    });

    const members = await this.listPipelineUsers(pipelineId, user);
    return { ...result, members };
  }

  /** Counts shown in the delete confirmation. */
  async getPipelineDeleteImpact(pipelineId: number, user: CrmUser) {
    await this.getManageablePipeline(pipelineId, user);

    const count = sql<number>`count(*)::int`;
    const [[deals], [stages]] = await Promise.all([
      this.db.select({ count }).from(crmDeals).where(eq(crmDeals.pipelineId, pipelineId)),
      this.db
        .select({ count })
        .from(crmPipelineStages)
        .where(eq(crmPipelineStages.pipelineId, pipelineId)),
    ]);
    return { dealCount: deals?.count ?? 0, stageCount: stages?.count ?? 0 };
  }

  /**
   * Deletes a pipeline with its deals, stages, and access list. Clients are
   * never touched. Deals are removed explicitly here; the database keeps
   * ON DELETE RESTRICT on crm_deals.pipeline_id so no other path can drop a
   * pipeline's deals implicitly.
   */
  async deletePipeline(pipelineId: number, user: CrmUser) {
    await this.getManageablePipeline(pipelineId, user);

    return this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ id: crmPipelines.id })
        .from(crmPipelines)
        .where(eq(crmPipelines.id, pipelineId))
        .for('update');
      if (!locked) throw new NotFoundException('Pipeline not found.');

      const removedDeals = await tx
        .delete(crmDeals)
        .where(eq(crmDeals.pipelineId, pipelineId))
        .returning({ id: crmDeals.id });

      // Stages and crm_pipeline_users rows cascade from the pipeline.
      await tx.delete(crmPipelines).where(eq(crmPipelines.id, pipelineId));

      return { id: pipelineId, deletedDeals: removedDeals.length };
    });
  }

  // ---------------------------------------------------------------- stages

  async createStage(pipelineId: number, rawName: string, user: CrmUser) {
    const name = rawName.trim();
    if (!name) throw new BadRequestException('Stage name is required.');

    await this.getVisiblePipeline(pipelineId, user);
    const duplicateMessage = `A stage named "${name}" already exists in this pipeline.`;

    try {
      return await this.db.transaction(async (tx) => {
        const stages = await tx
          .select()
          .from(crmPipelineStages)
          .where(eq(crmPipelineStages.pipelineId, pipelineId))
          .for('update');

        if (stages.some((row) => nameKey(row.name) === nameKey(name))) {
          throw new ConflictException(duplicateMessage);
        }

        const [created] = await tx
          .insert(crmPipelineStages)
          .values({
            pipelineId,
            name,
            position: stages.length,
          })
          .returning();
        if (!created) throw new InternalServerErrorException('Unable to create stage.');
        return toStageResponse(created);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(duplicateMessage);
      throw error;
    }
  }

  async deleteStage(pipelineId: number, stageId: number, user: CrmUser) {
    await this.getVisiblePipeline(pipelineId, user);

    return this.db.transaction(async (tx) => {
      const stages = await tx
        .select()
        .from(crmPipelineStages)
        .where(eq(crmPipelineStages.pipelineId, pipelineId))
        .for('update');

      const stage = stages.find((row) => row.id === stageId);
      if (!stage) throw new NotFoundException('Stage not found in this pipeline.');
      if (stages.length <= 1) {
        throw new BadRequestException('A pipeline must keep at least one stage.');
      }

      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(crmDeals)
        .where(and(eq(crmDeals.pipelineId, pipelineId), eq(crmDeals.stageId, stageId)));
      if ((count ?? 0) > 0) {
        throw new ConflictException('This stage still has deals. Move or delete those deals first.');
      }

      const remaining = stages
        .filter((row) => row.id !== stageId)
        .sort((a, b) => a.position - b.position || a.id - b.id);

      const now = new Date();
      for (const [index, row] of remaining.entries()) {
        await tx
          .update(crmPipelineStages)
          .set({ position: index, updatedAt: now })
          .where(eq(crmPipelineStages.id, row.id));
      }

      await tx.delete(crmPipelineStages).where(eq(crmPipelineStages.id, stageId));
      return { id: stageId, deleted: true };
    });
  }

  async renameStage(pipelineId: number, stageId: number, rawName: string, user: CrmUser) {
    const name = rawName.trim();
    if (!name) throw new BadRequestException('Stage name is required.');

    await this.getVisiblePipeline(pipelineId, user);
    const duplicateMessage = `A stage named "${name}" already exists in this pipeline.`;

    try {
      return await this.db.transaction(async (tx) => {
        // Lock the pipeline's stages so a concurrent rename cannot slip in a duplicate.
        const stages = await tx
          .select()
          .from(crmPipelineStages)
          .where(eq(crmPipelineStages.pipelineId, pipelineId))
          .for('update');

        const stage = stages.find((row) => row.id === stageId);
        if (!stage) throw new NotFoundException('Stage not found in this pipeline.');
        if (stage.name === name) return toStageResponse(stage);

        if (stages.some((row) => row.id !== stageId && nameKey(row.name) === nameKey(name))) {
          throw new ConflictException(duplicateMessage);
        }

        const [updated] = await tx
          .update(crmPipelineStages)
          .set({ name, updatedAt: new Date() })
          .where(eq(crmPipelineStages.id, stageId))
          .returning();
        return toStageResponse(updated);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(duplicateMessage);
      throw error;
    }
  }

  async reorderStages(pipelineId: number, stageIds: number[], user: CrmUser) {
    if (new Set(stageIds).size !== stageIds.length) {
      throw new BadRequestException('stageIds must not contain duplicates.');
    }

    await this.getVisiblePipeline(pipelineId, user);

    return this.db.transaction(async (tx) => {
      const stages = await tx
        .select()
        .from(crmPipelineStages)
        .where(eq(crmPipelineStages.pipelineId, pipelineId))
        .for('update');

      // The request must list exactly the pipeline's current stages. This
      // rejects stale orders (a stage was added or removed meanwhile) and IDs
      // from other pipelines.
      const byId = new Map(stages.map((row) => [row.id, row]));
      if (stageIds.length !== byId.size || !stageIds.every((id) => byId.has(id))) {
        throw new ConflictException(
          'The stage list is out of date. Reload the pipeline and try again.',
        );
      }

      const now = new Date();
      const result: CrmPipelineStageRow[] = [];
      for (const [position, id] of stageIds.entries()) {
        const current = byId.get(id)!;
        if (current.position === position) {
          result.push(current);
          continue;
        }
        const [updated] = await tx
          .update(crmPipelineStages)
          .set({ position, updatedAt: now })
          .where(eq(crmPipelineStages.id, id))
          .returning();
        result.push(updated);
      }
      return result.map(toStageResponse);
    });
  }
}
