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
import { MenuAccess, MenuAccessGuard } from '../access/menu-access.guard';
import { CreateCrmPipelineDto } from './dto/create-pipeline.dto';
import { CreateCrmStageDto } from './dto/create-stage.dto';
import { RenameCrmPipelineDto } from './dto/rename-pipeline.dto';
import { RenameCrmStageDto } from './dto/rename-stage.dto';
import { ReorderCrmStagesDto } from './dto/reorder-stages.dto';
import { UpdateCrmDealAssignmentDto } from './dto/update-deal-assignment.dto';
import { CrmUser } from './crm-access';
import { CrmService } from './crm.service';

type AuthedRequest = { user: CrmUser };

@Controller('crm/pipelines')
@UseGuards(JwtGuard, MenuAccessGuard, RolesGuard)
@MenuAccess('menu:crm')
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  @Get()
  list(@Req() req: AuthedRequest) {
    return this.crm.listPipelines(req.user);
  }

  @Post()
  create(@Req() req: AuthedRequest, @Body() dto: CreateCrmPipelineDto) {
    return this.crm.createPipeline(dto, req.user);
  }

  /** Rename a pipeline. Superadmin/superuser, the creator, or an admin with access. */
  @Patch(':pipelineId')
  renamePipeline(
    @Req() req: AuthedRequest,
    @Param('pipelineId', ParseIntPipe) pipelineId: number,
    @Body() dto: RenameCrmPipelineDto,
  ) {
    return this.crm.renamePipeline(pipelineId, dto.name, req.user);
  }

  /** Choose how new deals in this pipeline are assigned. */
  @Patch(':pipelineId/deal-assignment')
  updateDealAssignmentMethod(
    @Req() req: AuthedRequest,
    @Param('pipelineId', ParseIntPipe) pipelineId: number,
    @Body() dto: UpdateCrmDealAssignmentDto,
  ) {
    return this.crm.updateDealAssignmentMethod(pipelineId, dto.method, req.user);
  }

  /** Deal and stage counts for the delete confirmation. */
  @Get(':pipelineId/delete-impact')
  deleteImpact(@Req() req: AuthedRequest, @Param('pipelineId', ParseIntPipe) pipelineId: number) {
    return this.crm.getPipelineDeleteImpact(pipelineId, req.user);
  }

  /** Delete a pipeline with its deals, stages, and access list. Clients are kept. */
  @Delete(':pipelineId')
  deletePipeline(@Req() req: AuthedRequest, @Param('pipelineId', ParseIntPipe) pipelineId: number) {
    return this.crm.deletePipeline(pipelineId, req.user);
  }

  /** Create a new stage inside this pipeline. */
  @Post(':pipelineId/stages')
  createStage(
    @Req() req: AuthedRequest,
    @Param('pipelineId', ParseIntPipe) pipelineId: number,
    @Body() dto: CreateCrmStageDto,
  ) {
    return this.crm.createStage(pipelineId, dto.name, req.user);
  }

  /** Replace the stage order. Body: every stage ID of the pipeline, in order. */
  @Put(':pipelineId/stages/order')
  reorderStages(
    @Req() req: AuthedRequest,
    @Param('pipelineId', ParseIntPipe) pipelineId: number,
    @Body() dto: ReorderCrmStagesDto,
  ) {
    return this.crm.reorderStages(pipelineId, dto.stageIds, req.user);
  }

  /** Delete one stage from the pipeline. */
  @Delete(':pipelineId/stages/:stageId')
  deleteStage(
    @Req() req: AuthedRequest,
    @Param('pipelineId', ParseIntPipe) pipelineId: number,
    @Param('stageId', ParseIntPipe) stageId: number,
  ) {
    return this.crm.deleteStage(pipelineId, stageId, req.user);
  }

  /** Rename one stage of the pipeline. */
  @Patch(':pipelineId/stages/:stageId')
  renameStage(
    @Req() req: AuthedRequest,
    @Param('pipelineId', ParseIntPipe) pipelineId: number,
    @Param('stageId', ParseIntPipe) stageId: number,
    @Body() dto: RenameCrmStageDto,
  ) {
    return this.crm.renameStage(pipelineId, stageId, dto.name, req.user);
  }
}
