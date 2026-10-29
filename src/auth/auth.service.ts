import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AccessService } from '../access/access.service';
import { UsersService } from '../users/users.service';

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  role: string;
}

export interface LoginResult {
  token: string;
  user: AuthUser;
  deniedMenus: string[] | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly access: AccessService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.users.findByEmail(email);

    if (!user) {
      throw new UnauthorizedException('Incorrect email or password');
    }
    if (user.status === 'inactive') {
      throw new ForbiddenException('User has been deactivated');
    }
    if (!(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Incorrect email or password');
    }

    const payload: AuthUser = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
    };

    const token = await this.jwt.signAsync(payload);

    let deniedMenus: string[] | null = null;
    if (user.role !== 'superadmin' && user.role !== 'superuser') {
      const rows = await this.access.list(user.id);
      // No rows => default allow-all. Otherwise, deny only explicit false rows.
      deniedMenus = rows.length === 0
        ? null
        : rows.filter((row) => !row.allowed).map((row) => row.code);
    }

    return {
      token,
      user: payload,
      deniedMenus,
    };
  }
}

