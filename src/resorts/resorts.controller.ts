import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { Roles, RolesGuard } from '../auth/guards/roles.guard';
import { CreateResortDto } from './dto/create-resort.dto';
import { UpdateResortDto } from './dto/update-resort.dto';
import { ResortsService } from './resorts.service';

@Controller('resorts')
@UseGuards(JwtGuard, RolesGuard)
export class ResortsController {
  constructor(private readonly resorts: ResortsService) {}

  @Get()
  list(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.resorts.list({ search, page: Number(page), pageSize: Number(limit) });
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.resorts.findOne(id);
  }

  @Post()
  @Roles('superadmin')
  create(@Body() dto: CreateResortDto) {
    return this.resorts.create(dto);
  }

  @Patch(':id')
  @Roles('superadmin')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateResortDto) {
    return this.resorts.update(id, dto);
  }

  @Delete(':id')
  @Roles('superadmin')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.resorts.remove(id);
  }

  @Post(':id/images/:slot')
  @Roles('superadmin')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  uploadImage(
    @Param('id', ParseIntPipe) id: number,
    @Param('slot', ParseIntPipe) slot: number,
    @UploadedFile() file: any,
  ) {
    if (slot < 1 || slot > 3) throw new BadRequestException('Slot must be 1, 2, or 3.');
    if (!file) throw new BadRequestException('File is required.');
    return this.resorts.assignImage(id, slot, file);
  }

  @Delete(':id/images/:slot')
  @Roles('superadmin')
  removeImage(
    @Param('id', ParseIntPipe) id: number,
    @Param('slot', ParseIntPipe) slot: number,
  ) {
    if (slot < 1 || slot > 3) throw new BadRequestException('Slot must be 1, 2, or 3.');
    return this.resorts.clearImage(id, slot);
  }
}
