import { Body, Controller, Get, Param, Put, Query, Req, UseGuards } from '@nestjs/common';
import { IsArray, IsString } from 'class-validator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { Roles, RolesGuard } from '../auth/guards/roles.guard';
import { AccessService } from './access.service';

class UpdateAccessDto {
  @IsArray()
  @IsString({ each: true })
  codes!: string[];
}

class UpdateMenuAccessDto {
  @IsArray()
  @IsString({ each: true })
  userIds!: string[];
}

@Controller('settings/access')
@UseGuards(JwtGuard, RolesGuard)
export class AccessController {
  constructor(private readonly access: AccessService) {}

  @Get('me')
  async getMyAccess(@Req() req: any): Promise<{ codes: string[] | null }> {
    const user = req.user as { id: string; role?: string } | undefined;
    if (!user?.id) return { codes: null };
    if (user.role === 'superadmin' || user.role === 'superuser') return { codes: null };
    const rows = await this.access.list(user.id);
    if (rows.length === 0) return { codes: null };
    return { codes: rows.filter((row) => row.allowed).map((row) => row.code) };
  }

  @Get('items')
  async getAccessItems(@Query('type') type?: string) {
    return this.access.getAccessItems(type);
  }

  @Get('menu/:code')
  @Roles('superadmin')
  async getMenuAccess(@Param('code') code: string) {
    return this.access.listByCode(code);
  }

  @Put('menu/:code')
  @Roles('superadmin')
  async setMenuAccess(@Param('code') code: string, @Body() dto: UpdateMenuAccessDto) {
    const ids = dto.userIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    return this.access.setMenuAccess(code, ids);
  }

  @Get(':userId')
  @Roles('superadmin')
  async getUserAccess(@Param('userId') userId: string) {
    return this.access.list(userId);
  }

  @Put(':userId')
  @Roles('superadmin')
  async setUserAccess(@Param('userId') userId: string, @Body() dto: UpdateAccessDto) {
    const codes = dto.codes.filter((code) => /^[a-z0-9:_-]+$/i.test(code));
    return this.access.replaceForUser(userId, codes);
  }
}
