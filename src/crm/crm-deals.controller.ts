import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CrmUser } from './crm-access';
import { CrmDealsService } from './crm-deals.service';
import { AddExistingCrmDealsDto } from './dto/add-existing-deals.dto';
import { CreateCrmDealDto } from './dto/create-deal.dto';
import { MoveCrmDealDto } from './dto/move-deal.dto';

type AuthedRequest = { user: CrmUser };

/** Deal endpoints. All require access to the deal's pipeline. */
@Controller('crm')
@UseGuards(JwtGuard, RolesGuard)
export class CrmDealsController {
  constructor(private readonly deals: CrmDealsService) {}

  /** Deals in a pipeline, newest first, with the client fields cards show. */
  @Get('pipelines/:pipelineId/deals')
  list(@Req() req: AuthedRequest, @Param('pipelineId', ParseIntPipe) pipelineId: number) {
    return this.deals.listDeals(pipelineId, req.user);
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

  /** Move a deal to another stage of its pipeline. */
  @Patch('deals/:dealId')
  move(
    @Req() req: AuthedRequest,
    @Param('dealId', ParseIntPipe) dealId: number,
    @Body() dto: MoveCrmDealDto,
  ) {
    return this.deals.moveDeal(dealId, dto.stageId, req.user);
  }
}
