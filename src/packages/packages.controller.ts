import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { PackagesService } from './packages.service';

@Controller('packages')
@UseGuards(JwtGuard)
export class PackagesController {
  constructor(private readonly packages: PackagesService) {}

  @Get('categories')
  async categories() {
    return this.packages.categories();
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
