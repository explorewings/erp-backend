import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { and, eq } from 'drizzle-orm';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { Roles, RolesGuard } from '../auth/guards/roles.guard';
import { DRIZZLE, DrizzleDb } from '../database.module';
import { access, accessItems, NewUserRow, UserRow, users } from '../schema';
import { UsersService } from '../users/users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Controller('settings')
@UseGuards(JwtGuard, RolesGuard)
export class SettingsController {
  constructor(
    private readonly users: UsersService,
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
  ) {}

  @Get('users')
  async getUsers() {
    return this.users.findAll();
  }

  @Post('users')
  @HttpCode(201)
  @Roles('superadmin')
  async createUser(@Body() dto: CreateUserDto): Promise<Omit<UserRow, 'passwordHash'>> {
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const values: NewUserRow = {
      username: dto.username.trim(),
      email: dto.email.trim().toLowerCase(),
      passwordHash,
      role: dto.role,
    };

    try {
      const created = await this.db.transaction(async (tx) => {
        const user = await tx
          .insert(users)
          .values(values)
          .returning()
          .then((rows) => rows[0]);
        if (!user) return undefined;

        if (dto.accessCodes !== undefined) {
          const codes = new Set(
            dto.accessCodes.filter((code) => /^[a-z0-9:_-]+$/i.test(code)),
          );
          const menuItems = await tx
            .select({ code: accessItems.code })
            .from(accessItems)
            .where(and(eq(accessItems.type, 'menu'), eq(accessItems.isActive, true)));

          if (menuItems.length > 0) {
            await tx.insert(access).values(
              menuItems.map(({ code }) => ({
                userId: user.id,
                code,
                type: 'menu',
                allowed: codes.has(code),
              })),
            );
          }
        }

        return user;
      });
      if (!created) {
        throw new BadRequestException('Unable to create user.');
      }
      const { passwordHash: _passwordHash, ...rest } = created;
      return rest;
    } catch (error: any) {
      if (error?.code === '23505') {
        throw new BadRequestException('Username or email already exists.');
      }
      throw error;
    }
  }

  @Patch('users/:id')
  @Roles('superadmin')
  async updateUser(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<Omit<UserRow, 'passwordHash'>> {
    const existing = await this.db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, id) });
    if (!existing) {
      throw new BadRequestException('User not found.');
    }
    if (
      (existing.role === 'superadmin' || existing.role === 'superuser') &&
      dto.status !== undefined
    ) {
      throw new BadRequestException('The superadmin account cannot be deactivated.');
    }

    const updates: Partial<NewUserRow> = {};

    if (dto.username !== undefined) updates.username = dto.username.trim();
    if (dto.email !== undefined) updates.email = dto.email.trim().toLowerCase();
    if (dto.role !== undefined) updates.role = dto.role;
    if (dto.status !== undefined) updates.status = dto.status;
    if (dto.password !== undefined) {
      updates.passwordHash = await bcrypt.hash(dto.password, 10);
    }

    if (Object.keys(updates).length === 0) {
      const { passwordHash: _passwordHash, ...rest } = existing;
      return rest;
    }

    try {
      const updated = await this.db
        .update(users)
        .set(updates)
        .where(eq(users.id, id))
        .returning()
        .then((rows) => rows[0]);
      // Fallback if the where syntax above is unsupported by this drizzle version.
      if (!updated) {
        throw new BadRequestException('User not found or update failed.');
      }
      const { passwordHash: _passwordHash, ...rest } = updated;
      return rest;
    } catch (error: any) {
      if (error?.code === '23505') {
        throw new BadRequestException('Username or email already exists.');
      }
      throw error;
    }
  }


  @Delete('users/:id')
  @Roles('superadmin')
  async deleteUser(@Param('id') id: string): Promise<{ deleted: string }> {
    const existing = await this.db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, id) });
    if (!existing) throw new BadRequestException('User not found.');
    if (existing.role === 'superadmin' || existing.role === 'superuser') {
      throw new BadRequestException('The superadmin account cannot be deleted.');
    }
    await this.db.delete(users).where(eq(users.id, id));
    return { deleted: id };
  }

}