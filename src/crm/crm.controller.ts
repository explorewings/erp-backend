import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateCrmPipelineDto } from './dto/create-pipeline.dto';
import { RenameCrmPipelineDto } from './dto/rename-pipeline.dto';
import { RenameCrmStageDto } from './dto/rename-stage.dto';
import { ReorderCrmStagesDto } from './dto/reorder-stages.dto';
import { CrmService } from './crm.service';

@Controller('crm/pipelines')
@UseGuards(JwtGuard, RolesGuard)
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  @Get()
  list(@Req() req: any) {
    return this.crm.listPipelines(req.user);
  }

  @Post()
  create(@Req() req: any, @Body() dto: CreateCrmPipelineDto) {
    return this.crm.createPipeline(
      {
        name: dto.name,
        stages: dto.stages,
        allowedUserIds: dto.allowedUserIds,
      },
      req.user,
    );
  }

  /** Rename a pipeline. Superadmin/superuser, the creator, or an admin with access. */
  @Patch(':pipelineId')
  renamePipeline(
    @Req() req: any,
    @Param('pipelineId', ParseIntPipe) pipelineId: number,
    @Body() dto: RenameCrmPipelineDto,
  ) {
    return this.crm.renamePipeline(pipelineId, dto.name, req.user);
  }

  /** Deal and stage counts for the delete confirmation. */
  @Get(':pipelineId/delete-impact')
  deleteImpact(@Req() req: any, @Param('pipelineId', ParseIntPipe) pipelineId: number) {
    return this.crm.getPipelineDeleteImpact(pipelineId, req.user);
  }

  /** Delete a pipeline with its deals, stages, and access list. Clients are kept. */
  @Delete(':pipelineId')
  deletePipeline(@Req() req: any, @Param('pipelineId', ParseIntPipe) pipelineId: number) {
    return this.crm.deletePipeline(pipelineId, req.user);
  }

  /** Replace the stage order. Body: every stage ID of the pipeline, in order. */
  @Put(':pipelineId/stages/order')
  reorderStages(
    @Req() req: any,
    @Param('pipelineId', ParseIntPipe) pipelineId: number,
    @Body() dto: ReorderCrmStagesDto,
  ) {
    return this.crm.reorderStages(pipelineId, dto.stageIds, req.user);
  }

  /** Rename one stage of the pipeline. */
  @Patch(':pipelineId/stages/:stageId')
  renameStage(
    @Req() req: any,
    @Param('pipelineId', ParseIntPipe) pipelineId: number,
    @Param('stageId', ParseIntPipe) stageId: number,
    @Body() dto: RenameCrmStageDto,
  ) {
    return this.crm.renameStage(pipelineId, stageId, dto.name, req.user);
  }
}
