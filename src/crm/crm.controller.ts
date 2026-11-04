import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { Roles, RolesGuard } from '../auth/guards/roles.guard';
import { CreateCrmPipelineDto } from './dto/create-pipeline.dto';
import { CrmService } from './crm.service';

@Controller('crm/pipelines')
@UseGuards(JwtGuard, RolesGuard)
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  @Get()
  list() {
    return this.crm.listPipelines();
  }

  @Post()
  @Roles('superadmin', 'superuser')
  create(@Body() dto: CreateCrmPipelineDto) {
    return this.crm.createPipeline({
      name: dto.name,
      stages: dto.stages,
    });
  }
}
