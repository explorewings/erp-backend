import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateCrmPipelineDto } from './dto/create-pipeline.dto';
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
}
