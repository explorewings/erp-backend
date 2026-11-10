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
  async getMyAccess(@Req() req: any): Promise<{ grantedMenus: string[]; role: string | null }> {
    const user = req.user as { id: string } | undefined;
    if (!user?.id) return { grantedMenus: [], role: null };
    const [grantedMenus, role] = await Promise.all([
      this.access.getAllowedCodes(user.id),
      this.access.getUserRole(user.id),
    ]);
    return { grantedMenus, role };
  }

  @Get('items')
  async getAccessItems(@Query('type') type?: string) {
    return this.access.getAccessItems(type);
  }

  @Get('menu/:code')
  @Roles('superadmin', 'superuser')
  async getMenuAccess(@Param('code') code: string) {
    return this.access.listByCode(code);
  }

  @Put('menu/:code')
  @Roles('superadmin', 'superuser')
  async setMenuAccess(@Param('code') code: string, @Body() dto: UpdateMenuAccessDto) {
    const ids = dto.userIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    return this.access.setMenuAccess(code, ids);
  }

  @Get(':userId')
  @Roles('superadmin', 'superuser')
  async getUserAccess(@Param('userId') userId: string) {
    return this.access.list(userId);
  }

  @Put(':userId')
  @Roles('superadmin', 'superuser')
  async setUserAccess(@Param('userId') userId: string, @Body() dto: UpdateAccessDto) {
    const codes = dto.codes.filter((code) => /^[a-z0-9:_-]+$/i.test(code));
    return this.access.replaceForUser(userId, codes);
  }
}
