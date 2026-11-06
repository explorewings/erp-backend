import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, asc, inArray, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../database.module';
import { crmDeals, crmPipelineStages, crmPipelines, crmPipelineUsers, users } from '../schema';

type RequestUser = { id: string; username: string; email: string; role: string };

type CrmStageRow = typeof crmPipelineStages.$inferSelect;

function toStageResponse(stage: CrmStageRow) {
  return {
    id: stage.id,
    pipelineId: stage.pipelineId,
    name: stage.name,
    position: stage.position,
    createdAt: stage.createdAt,
    updatedAt: stage.updatedAt,
  };
}

function isSuperRole(role: string): boolean {
  return role === 'superadmin' || role === 'superuser';
}

/**
 * Who may rename or delete a pipeline:
 * - superadmin / superuser: any pipeline;
 * - the pipeline's creator;
 * - an admin who has been granted access to the pipeline.
 * Staff never can, even with access.
 */
function canManagePipeline(
  user: RequestUser,
  pipeline: { createdBy: string | null },
  hasGrant: boolean,
): boolean {
  if (isSuperRole(user.role)) return true;
  if (pipeline.createdBy === user.id) return true;
  return user.role === 'admin' && hasGrant;
}

function isUniqueViolation(error: unknown): boolean {
  const code =
    (error as { code?: string })?.code ?? (error as { cause?: { code?: string } })?.cause?.code;
  return code === '23505';
}

@Injectable()
export class CrmService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async listPipelines(user: RequestUser) {
    const allPipelines = await this.db
      .select()
      .from(crmPipelines)
      .orderBy(asc(crmPipelines.position), asc(crmPipelines.id));

    if (allPipelines.length === 0) return [];

    const isSuper = isSuperRole(user.role);
    const visibleIds = new Set<number>();
    const grantedIds = new Set<number>();

    if (isSuper) {
      for (const pipeline of allPipelines) visibleIds.add(pipeline.id);
    } else {
      const accessibleRows = await this.db
        .select({ pipelineId: crmPipelineUsers.pipelineId })
        .from(crmPipelineUsers)
        .where(eq(crmPipelineUsers.userId, user.id));
      for (const row of accessibleRows) {
        visibleIds.add(row.pipelineId);
        grantedIds.add(row.pipelineId);
      }
      for (const pipeline of allPipelines) {
        if (pipeline.createdBy === user.id) visibleIds.add(pipeline.id);
      }
    }

    const visiblePipelines = allPipelines.filter((pipeline) => visibleIds.has(pipeline.id));
    if (visiblePipelines.length === 0) return [];

    const stageRows = await this.db
      .select()
      .from(crmPipelineStages)
      .orderBy(asc(crmPipelineStages.position), asc(crmPipelineStages.id));

    const accessRows = await this.db
      .select({ pipelineId: crmPipelineUsers.pipelineId, userId: crmPipelineUsers.userId })
      .from(crmPipelineUsers);

    const stagesByPipeline = new Map<number, typeof stageRows>();
    for (const stage of stageRows) {
      const current = stagesByPipeline.get(stage.pipelineId) ?? [];
      current.push(stage);
      stagesByPipeline.set(stage.pipelineId, current);
    }

    const usersByPipeline = new Map<number, string[]>();
    for (const access of accessRows) {
      const current = usersByPipeline.get(access.pipelineId) ?? [];
      current.push(access.userId);
      usersByPipeline.set(access.pipelineId, current);
    }

    return visiblePipelines.map((pipeline) => ({
      id: pipeline.id,
      name: pipeline.name,
      position: pipeline.position,
      createdAt: pipeline.createdAt,
      updatedAt: pipeline.updatedAt,
      createdBy: pipeline.createdBy,
      allowedUserIds: usersByPipeline.get(pipeline.id) ?? [],
      canManage: canManagePipeline(user, pipeline, grantedIds.has(pipeline.id)),
      stages: (stagesByPipeline.get(pipeline.id) ?? []).map((stage) => ({
        id: stage.id,
        pipelineId: stage.pipelineId,
        name: stage.name,
        position: stage.position,
        createdAt: stage.createdAt,
        updatedAt: stage.updatedAt,
      })),
    }));
  }

  async createPipeline(
    dto: { name: string; stages: string[]; allowedUserIds?: string[] },
    user: RequestUser,
  ) {
    const name = dto.name.trim();
    const stages = dto.stages.map((stage) => stage.trim()).filter(Boolean);
    if (!name) throw new BadRequestException('Pipeline name is required.');
    if (stages.length === 0) throw new BadRequestException('At least one stage is required.');

    // Stage names are unique per pipeline. Compare case-insensitively so
    // "Won" and "won" are not created as two separate columns.
    const seenStages = new Set<string>();
    for (const stage of stages) {
      const key = stage.toLocaleLowerCase();
      if (seenStages.has(key)) {
        throw new BadRequestException(`Duplicate stage name: "${stage}".`);
      }
      seenStages.add(key);
    }

    const allowedIds = new Set<string>(dto.allowedUserIds ?? []);
    allowedIds.add(user.id);

    // Reject unknown or inactive users up front instead of surfacing a
    // foreign-key violation as a 500.
    const requestedUserIds = [...allowedIds];
    const existingUsers = await this.db
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(inArray(users.id, requestedUserIds));
    const activeUserIds = new Set(
      existingUsers.filter((row) => row.status !== 'inactive').map((row) => row.id),
    );
    const invalidUserIds = requestedUserIds.filter(
      (id) => id !== user.id && !activeUserIds.has(id),
    );
    if (invalidUserIds.length > 0) {
      throw new BadRequestException('One or more selected users do not exist or are inactive.');
    }

    try {
      return await this.db.transaction(async (tx) => {
        // Append new pipelines after existing ones so the selector order is stable.
        const [{ nextPosition }] = await tx
          .select({ nextPosition: sql<number>`COALESCE(MAX(${crmPipelines.position}) + 1, 0)::int` })
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
        createdStages.sort((a, b) => a.position - b.position);

        await tx
          .insert(crmPipelineUsers)
          .values(requestedUserIds.map((userId) => ({ pipelineId: pipeline.id, userId })))
          .onConflictDoNothing();

        return {
          id: pipeline.id,
          name: pipeline.name,
          position: pipeline.position,
          createdAt: pipeline.createdAt,
          updatedAt: pipeline.updatedAt,
          createdBy: pipeline.createdBy,
          allowedUserIds: requestedUserIds,
          canManage: true,
          stages: createdStages.map((stage) => ({
            id: stage.id,
            pipelineId: stage.pipelineId,
            name: stage.name,
            position: stage.position,
            createdAt: stage.createdAt,
            updatedAt: stage.updatedAt,
          })),
        };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('A stage with this name already exists in the pipeline.');
      }
      throw error;
    }
  }

  /**
   * Loads a pipeline the user may see. Pipelines the user cannot access are
   * reported as not found so their existence is not leaked. Also reports
   * whether the user may rename or delete it.
   */
  private async getAccessiblePipeline(pipelineId: number, user: RequestUser) {
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
      if (!hasGrant && pipeline.createdBy !== user.id) {
        throw new NotFoundException('Pipeline not found.');
      }
    }

    return { pipeline, canManage: canManagePipeline(user, pipeline, hasGrant) };
  }

  private async assertPipelineAccess(pipelineId: number, user: RequestUser) {
    await this.getAccessiblePipeline(pipelineId, user);
  }

  private async assertCanManagePipeline(pipelineId: number, user: RequestUser) {
    const access = await this.getAccessiblePipeline(pipelineId, user);
    if (!access.canManage) {
      throw new ForbiddenException('You do not have permission to change this pipeline.');
    }
    return access.pipeline;
  }

  async renamePipeline(pipelineId: number, rawName: string, user: RequestUser) {
    const name = rawName.trim();
    if (!name) throw new BadRequestException('Pipeline name is required.');

    const pipeline = await this.assertCanManagePipeline(pipelineId, user);
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

  /** Counts shown in the delete confirmation. */
  async getPipelineDeleteImpact(pipelineId: number, user: RequestUser) {
    await this.assertCanManagePipeline(pipelineId, user);

    const [[deals], [stages]] = await Promise.all([
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(crmDeals)
        .where(eq(crmDeals.pipelineId, pipelineId)),
      this.db
        .select({ count: sql<number>`count(*)::int` })
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
  async deletePipeline(pipelineId: number, user: RequestUser) {
    await this.assertCanManagePipeline(pipelineId, user);

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

  async renameStage(pipelineId: number, stageId: number, rawName: string, user: RequestUser) {
    const name = rawName.trim();
    if (!name) throw new BadRequestException('Stage name is required.');

    await this.assertPipelineAccess(pipelineId, user);

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

        const key = name.toLocaleLowerCase();
        const clash = stages.some(
          (row) => row.id !== stageId && row.name.toLocaleLowerCase() === key,
        );
        if (clash) {
          throw new ConflictException(`A stage named "${name}" already exists in this pipeline.`);
        }

        const [updated] = await tx
          .update(crmPipelineStages)
          .set({ name, updatedAt: new Date() })
          .where(
            and(eq(crmPipelineStages.id, stageId), eq(crmPipelineStages.pipelineId, pipelineId)),
          )
          .returning();
        if (!updated) throw new NotFoundException('Stage not found in this pipeline.');
        return toStageResponse(updated);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(`A stage named "${name}" already exists in this pipeline.`);
      }
      throw error;
    }
  }

  async reorderStages(pipelineId: number, stageIds: number[], user: RequestUser) {
    if (new Set(stageIds).size !== stageIds.length) {
      throw new BadRequestException('stageIds must not contain duplicates.');
    }

    await this.assertPipelineAccess(pipelineId, user);

    return this.db.transaction(async (tx) => {
      const stages = await tx
        .select()
        .from(crmPipelineStages)
        .where(eq(crmPipelineStages.pipelineId, pipelineId))
        .for('update');

      // The request must list exactly the pipeline's current stages. This
      // rejects stale orders (a stage was added or removed meanwhile) and IDs
      // from other pipelines.
      const currentIds = new Set(stages.map((row) => row.id));
      const matches =
        stageIds.length === currentIds.size && stageIds.every((id) => currentIds.has(id));
      if (!matches) {
        throw new ConflictException(
          'The stage list is out of date. Reload the pipeline and try again.',
        );
      }

      const now = new Date();
      const byId = new Map(stages.map((row) => [row.id, row]));
      const result: CrmStageRow[] = [];
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
