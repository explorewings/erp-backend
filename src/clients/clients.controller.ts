import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { Roles, RolesGuard } from '../auth/guards/roles.guard';
import { CreateClientDto } from './dto/create-client.dto';
import { ClientsService } from './clients.service';

@Controller('clients')
@UseGuards(JwtGuard, RolesGuard)
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  list(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.clients.list({ search, page: Number(page), pageSize: Number(limit) });
  }

  @Post()
  @Roles('superadmin', 'superuser')
  create(@Body() dto: CreateClientDto) {
    return this.clients.create(dto);
  }
}
