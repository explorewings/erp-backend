import { Injectable, CanActivate, ExecutionContext, ForbiddenException, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessService } from '../../access/access.service';

export const ROLES_KEY = 'roles';

/**
 * Decorator: `@Roles('superadmin')` restricts a route to those roles.
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as { role?: string } | undefined;

    const userId = (request.user as { id?: string } | undefined)?.id;
    const currentRole = userId ? await this.access.getUserRole(userId) : null;
    if (!user || !currentRole) {
      throw new ForbiddenException('Insufficient permissions');
    }
    user.role = currentRole;

    const required = this.reflector.get<string[]>(ROLES_KEY, context.getHandler());
    if (!required || required.length === 0) {
      return true;
    }

    if (!required.includes(user.role)) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
