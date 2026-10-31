import { Body, Controller, Delete, Get, NotFoundException, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
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

  @Patch(':id')
  @Roles('superadmin', 'superuser')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateClientDto) {
    const updated = await this.clients.update(id, dto);
    if (!updated) throw new NotFoundException(`Client ${id} not found`);
    return updated;
  }

  @Delete(':id')
  @Roles('superadmin', 'superuser')
  async remove(@Param('id', ParseIntPipe) id: number) {
    const deleted = await this.clients.remove(id);
    if (!deleted) throw new NotFoundException(`Client ${id} not found`);
    return deleted;
  }
}
