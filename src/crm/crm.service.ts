import { Inject, Injectable } from '@nestjs/common';
import { eq, asc } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../database.module';
import { crmPipelineStages, crmPipelines } from '../schema';

@Injectable()
export class CrmService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async listPipelines() {
    const pipelines = await this.db
      .select()
      .from(crmPipelines)
      .orderBy(asc(crmPipelines.position), asc(crmPipelines.id));

    if (pipelines.length === 0) return [];

    const stageRows = await this.db
      .select()
      .from(crmPipelineStages)
      .orderBy(asc(crmPipelineStages.position), asc(crmPipelineStages.id));

    const stagesByPipeline = new Map<number, typeof stageRows>();
    for (const stage of stageRows) {
      const current = stagesByPipeline.get(stage.pipelineId) ?? [];
      current.push(stage);
      stagesByPipeline.set(stage.pipelineId, current);
    }

    return pipelines.map((pipeline) => ({
      id: pipeline.id,
      name: pipeline.name,
      position: pipeline.position,
      createdAt: pipeline.createdAt,
      updatedAt: pipeline.updatedAt,
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

  async createPipeline(dto: { name: string; stages: string[] }) {
    const name = dto.name.trim();
    const stages = dto.stages.map((stage) => stage.trim()).filter(Boolean);
    if (!name) throw new Error('Pipeline name is required.');
    if (stages.length === 0) throw new Error('At least one stage is required.');

    return this.db.transaction(async (tx) => {
      const [pipeline] = await tx
        .insert(crmPipelines)
        .values({ name, position: 0 })
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

      return {
        id: pipeline.id,
        name: pipeline.name,
        position: pipeline.position,
        createdAt: pipeline.createdAt,
        updatedAt: pipeline.updatedAt,
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
