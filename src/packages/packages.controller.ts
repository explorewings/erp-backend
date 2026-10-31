import { BadRequestException, Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { Roles, RolesGuard } from '../auth/guards/roles.guard';
import { PackagesService } from './packages.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { CreatePackageDto } from './dto/create-package.dto';
import { UpdatePackageDto } from './dto/update-package.dto';

@Controller('packages')
@UseGuards(JwtGuard, RolesGuard)
export class PackagesController {
  constructor(private readonly packages: PackagesService) {}


  @Post()
  @Roles('superadmin')
  async create(@Body() dto: CreatePackageDto) {
    return this.packages.create(dto);
  }

  @Get('categories')
  async categories() {
    return this.packages.categories();
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.packages.findOne(id);
  }


  @Patch(':id')
  @Roles('superadmin')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePackageDto) {
    return this.packages.update(id, dto);
  }

  @Delete(':id')
  @Roles('superadmin')
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.packages.remove(id);
  }

  @Post(':id/images/:slot')
  @Roles('superadmin')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async uploadImage(
    @Param('id', ParseIntPipe) id: number,
    @Param('slot', ParseIntPipe) slot: number,
    @UploadedFile() file: any,
  ) {
    if (slot < 1 || slot > 3) throw new BadRequestException('Slot must be 1, 2, or 3.');
    if (!file) throw new BadRequestException('File is required.');
    return this.packages.assignImage(id, slot, file);
  }

  @Delete(':id/images/:slot')
  @Roles('superadmin')
  async removeImage(
    @Param('id', ParseIntPipe) id: number,
    @Param('slot', ParseIntPipe) slot: number,
  ) {
    if (slot < 1 || slot > 3) throw new BadRequestException('Slot must be 1, 2, or 3.');
    return this.packages.clearImage(id, slot);
  }

  @Get()
  async list(
    @Query('search') search?: string,
    @Query('category') category?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.packages.list({ search, category, page: Number(page), pageSize: Number(limit) });
  }
}
