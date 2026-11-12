import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { Roles, RolesGuard } from '../auth/guards/roles.guard';
import { MenuAccess, MenuAccessGuard } from '../access/menu-access.guard';
import { CrmUser } from './crm-access';
import { CrmAssignmentService } from './crm-assignment.service';
import { UpdateCrmDealAssignmentDto } from './dto/update-deal-assignment.dto';

type AuthedRequest = { user: CrmUser };

/**
 * Pipeline assignment rules. Changing the rule and bulk-assigning are
 * superadmin/superuser only for now; Settings → Permissions will govern
 * them later.
 */
@Controller('crm/pipelines')
@UseGuards(JwtGuard, MenuAccessGuard, RolesGuard)
@MenuAccess('menu:crm')
export class CrmAssignmentController {
  constructor(private readonly assignment: CrmAssignmentService) {}

  /** Saved rule, deal totals and per-user load. Any pipeline viewer. */
  @Get(':pipelineId/assignment')
  overview(@Req() req: AuthedRequest, @Param('pipelineId', ParseIntPipe) pipelineId: number) {
    return this.assignment.getOverview(pipelineId, req.user);
  }

  /** Save the pipeline's rule; new deals follow it from then on. */
  @Roles('superadmin', 'superuser')
  @Patch(':pipelineId/deal-assignment')
  updateRule(
    @Req() req: AuthedRequest,
    @Param('pipelineId', ParseIntPipe) pipelineId: number,
    @Body() dto: UpdateCrmDealAssignmentDto,
  ) {
    return this.assignment.updateRule(pipelineId, dto.method, dto.userId, req.user);
  }

  /** Assign the next chunk (≤ 100) of unassigned deals by the saved rule. */
  @Roles('superadmin', 'superuser')
  @Post(':pipelineId/assignments/distribute')
  distribute(@Req() req: AuthedRequest, @Param('pipelineId', ParseIntPipe) pipelineId: number) {
    return this.assignment.distributeUnassigned(pipelineId, req.user);
  }
}
