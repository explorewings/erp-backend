import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { Roles, RolesGuard } from '../auth/guards/roles.guard';
import { MenuAccess, MenuAccessGuard } from '../access/menu-access.guard';
import { CreateClientDto } from './dto/create-client.dto';
import { ClientsService } from './clients.service';

type AuthedRequest = { user: { id: string } };

@Controller('clients')
@UseGuards(JwtGuard, MenuAccessGuard, RolesGuard)
@MenuAccess('menu:clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  list(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('importId') importId?: string,
  ) {
    const parsedImportId = importId === undefined ? undefined : Number(importId);
    if (parsedImportId !== undefined && (!Number.isInteger(parsedImportId) || parsedImportId < 1)) {
      throw new BadRequestException('Import ID must be a positive integer.');
    }
    return this.clients.list({
      search,
      page: Number(page),
      pageSize: Number(limit),
      importId: parsedImportId,
    });
  }

  @Delete('bulk')
  @Roles('superadmin', 'superuser')
  removeMany(@Body() body: { ids?: unknown }) {
    const ids = body?.ids;
    if (
      !Array.isArray(ids) ||
      ids.length < 1 ||
      ids.length > 100 ||
      ids.some((id) => !Number.isInteger(id) || Number(id) < 1)
    ) {
      throw new BadRequestException('Provide between 1 and 100 valid client IDs.');
    }
    return this.clients.removeMany(ids as number[]);
  }

  @Delete('imports/:importId/bulk')
  @Roles('superadmin', 'superuser')
  removeImportBatch(@Param('importId', ParseIntPipe) importId: number) {
    return this.clients.removeImportBatch(importId);
  }

  /** Any signed-in user may add clients; editing and deleting stay restricted. */
  @Post()
  create(@Req() req: AuthedRequest, @Body() dto: CreateClientDto) {
    return this.clients.create(dto, req.user.id);
  }

  /** Thread history for one client (who added/edited, when, source). */
  @Get(':id/history')
  history(@Param('id', ParseIntPipe) id: number, @Query('page') page: number) {
    return this.clients.history(id, page ?? 1);
  }

  @Patch(':id')
  @Roles('superadmin', 'superuser')
  async update(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: CreateClientDto) {
    const updated = await this.clients.update(id, dto, req.user.id);
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
