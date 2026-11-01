import {
  Body,
  Controller,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { Roles, RolesGuard } from '../auth/guards/roles.guard';
import { AppendClientImportBatchDto } from './dto/append-client-import-batch.dto';
import { CreateClientImportDto } from './dto/create-client-import.dto';
import { ClientImportsService } from './client-imports.service';

interface AuthenticatedRequest extends Request {
  user: { id: string };
}

@Controller('client-imports')
@UseGuards(JwtGuard, RolesGuard)
export class ClientImportsController {
  constructor(private readonly imports: ClientImportsService) {}

  @Post()
  @Roles('superadmin', 'superuser')
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateClientImportDto) {
    return this.imports.create(dto, req.user.id);
  }

  @Post(':id/batches')
  @Roles('superadmin', 'superuser')
  appendBatch(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
    @Body() dto: AppendClientImportBatchDto,
  ) {
    return this.imports.appendBatch(id, req.user.id, dto);
  }

  @Post(':id/complete')
  @Roles('superadmin', 'superuser')
  complete(@Param('id', ParseIntPipe) id: number, @Req() req: AuthenticatedRequest) {
    return this.imports.complete(id, req.user.id);
  }

  @Post(':id/fail')
  @Roles('superadmin', 'superuser')
  fail(@Param('id', ParseIntPipe) id: number, @Req() req: AuthenticatedRequest) {
    return this.imports.fail(id, req.user.id);
  }
}
