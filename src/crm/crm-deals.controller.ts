import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { Roles, RolesGuard } from '../auth/guards/roles.guard';
import { MenuAccess, MenuAccessGuard } from '../access/menu-access.guard';
import { CrmUser } from './crm-access';
import { CrmDealsService } from './crm-deals.service';
import { AssignCrmDealDto } from './dto/assign-deal.dto';
import { AddExistingCrmDealsDto } from './dto/add-existing-deals.dto';
import { CrmBoardQueryDto, CrmDealIdsQueryDto, CrmStageDealsQueryDto } from './dto/board-query.dto';
import { CreateCrmDealDto } from './dto/create-deal.dto';
import { MoveCrmDealDto } from './dto/move-deal.dto';
import { TransferCrmDealsDto } from './dto/transfer-deals.dto';

type AuthedRequest = { user: CrmUser };

/** Deal endpoints. All require access to the deal's pipeline. */
@Controller('crm')
@UseGuards(JwtGuard, MenuAccessGuard, RolesGuard)
@MenuAccess('menu:crm')
export class CrmDealsController {
  constructor(private readonly deals: CrmDealsService) {}

  /** Active users who have CRM menu access. */
  @Get('users/eligible')
  listCrmEligibleUsers() {
    return this.deals.listCrmEligibleUsers();
  }

  /** Deals in a pipeline, newest first, with the client fields cards show. */
  @Get('pipelines/:pipelineId/deals')
  list(@Req() req: AuthedRequest, @Param('pipelineId', ParseIntPipe) pipelineId: number) {
    return this.deals.listDeals(pipelineId, req.user);
  }

  /** Kanban board: first 100 deals of every stage + each stage's total; `q` searches clients. */
  @Get('pipelines/:pipelineId/board')
  board(
    @Req() req: AuthedRequest,
    @Param('pipelineId', ParseIntPipe) pipelineId: number,
    @Query() query: CrmBoardQueryDto,
  ) {
    return this.deals.listBoard(pipelineId, query.q, req.user);
  }

  /** Next 100 deals of one stage (scrolling a column). */
  @Get('pipelines/:pipelineId/stages/:stageId/deals')
  stageDeals(
    @Req() req: AuthedRequest,
    @Param('pipelineId', ParseIntPipe) pipelineId: number,
    @Param('stageId', ParseIntPipe) stageId: number,
    @Query() query: CrmStageDealsQueryDto,
  ) {
    return this.deals.listStageDeals(pipelineId, stageId, query, req.user);
  }

  /** Ids of every deal in the given stages (Deal transfer). */
  @Get('pipelines/:pipelineId/deal-ids')
  dealIds(
    @Req() req: AuthedRequest,
    @Param('pipelineId', ParseIntPipe) pipelineId: number,
    @Query() query: CrmDealIdsQueryDto,
  ) {
    return this.deals.listDealIdsByStages(pipelineId, query.stageIds, req.user);
  }

  /** Active users who have both CRM menu access and access to this pipeline. */
  @Get('pipelines/:pipelineId/assignees')
  listEligibleAssignees(
    @Req() req: AuthedRequest,
    @Param('pipelineId', ParseIntPipe) pipelineId: number,
  ) {
    return this.deals.listEligibleAssignees(pipelineId, req.user);
  }

  /** Create a new client and add it to the pipeline's first stage. */
  @Post('pipelines/:pipelineId/deals')
  create(
    @Req() req: AuthedRequest,
    @Param('pipelineId', ParseIntPipe) pipelineId: number,
    @Body() dto: CreateCrmDealDto,
  ) {
    return this.deals.createDealWithClient(pipelineId, dto, req.user);
  }

  /** Add existing clients to a pipeline, skipping clients already in it. */
  @Post('pipelines/:pipelineId/deals/existing/bulk')
  addExisting(
    @Req() req: AuthedRequest,
    @Param('pipelineId', ParseIntPipe) pipelineId: number,
    @Body() dto: AddExistingCrmDealsDto,
  ) {
    return this.deals.addExistingClients(pipelineId, dto.clientIds, req.user);
  }

  /** Bulk move (same deals) or copy (new deals) into another pipeline. Super roles only for now. */
  @Roles('superadmin', 'superuser')
  @Post('deals/transfer')
  transfer(@Req() req: AuthedRequest, @Body() dto: TransferCrmDealsDto) {
    return this.deals.transferDeals(dto, req.user);
  }

  /** Move a deal to another stage of its pipeline. */
  @Patch('deals/:dealId')
  move(
    @Req() req: AuthedRequest,
    @Param('dealId', ParseIntPipe) dealId: number,
    @Body() dto: MoveCrmDealDto,
  ) {
    return this.deals.moveDeal(dealId, dto.stageId, req.user);
  }

  /** Remove one deal from its pipeline without deleting its client. */
  @Delete('deals/:dealId')
  remove(@Req() req: AuthedRequest, @Param('dealId', ParseIntPipe) dealId: number) {
    return this.deals.removeDeal(dealId, req.user);
  }

  /** Assign or clear the owner of a deal. Owners must have access to its pipeline. */
  @Patch('deals/:dealId/assignment')
  assign(
    @Req() req: AuthedRequest,
    @Param('dealId', ParseIntPipe) dealId: number,
    @Body() dto: AssignCrmDealDto,
  ) {
    return this.deals.assignDeal(dealId, dto, req.user);
  }
}
