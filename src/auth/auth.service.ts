import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
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
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.users.findByEmail(email);

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Incorrect email or password');
    }

    const payload: AuthUser = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
    };

    const token = await this.jwt.signAsync(payload);

    return { token, user: payload };
  }
}
