import { Inject, Injectable } from '@nestjs/common';
import { eq, asc, inArray } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../database.module';
import {
  crmPipelineStages,
  crmPipelines,
  crmPipelineUsers,
  NewCrmPipelineRow,
} from '../schema';

type RequestUser = { id: string; username: string; email: string; role: string };

@Injectable()
export class CrmService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async listPipelines(user: RequestUser) {
    const allPipelines = await this.db
      .select()
      .from(crmPipelines)
      .orderBy(asc(crmPipelines.position), asc(crmPipelines.id));

    if (allPipelines.length === 0) return [];

    const isSuper = user.role === 'superadmin' || user.role === 'superuser';
    let visibleIds = new Set<number>();

    if (isSuper) {
      for (const pipeline of allPipelines) visibleIds.add(pipeline.id);
    } else {
      const accessibleRows = await this.db
        .select({ pipelineId: crmPipelineUsers.pipelineId })
        .from(crmPipelineUsers)
        .where(eq(crmPipelineUsers.userId, user.id));
      for (const row of accessibleRows) visibleIds.add(row.pipelineId);
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
    if (!name) throw new Error('Pipeline name is required.');
    if (stages.length === 0) throw new Error('At least one stage is required.');

    return this.db.transaction(async (tx) => {
      const [pipeline] = await tx
        .insert(crmPipelines)
        .values({ name, position: 0, createdBy: user.id })
        .returning();
      if (!pipeline) throw new Error('Unable to create pipeline.');

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

      const allowedIds = new Set<string>(dto.allowedUserIds ?? []);
      allowedIds.add(user.id);

      if (allowedIds.size > 0) {
        await tx
          .insert(crmPipelineUsers)
          .values([...allowedIds].map((userId) => ({ pipelineId: pipeline.id, userId })))
          .onConflictDoNothing();
      }

      return {
        id: pipeline.id,
        name: pipeline.name,
        position: pipeline.position,
        createdAt: pipeline.createdAt,
        updatedAt: pipeline.updatedAt,
        createdBy: pipeline.createdBy,
        allowedUserIds: [...allowedIds],
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
  }
}
