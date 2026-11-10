import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessService } from './access.service';

const MENU_ACCESS_KEY = 'menu-access';

export const MenuAccess = (code: string) => SetMetadata(MENU_ACCESS_KEY, code);

@Injectable()
export class MenuAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const code = this.reflector.getAllAndOverride<string>(MENU_ACCESS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!code) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as { id?: string } | undefined;
    if (!user?.id || !(await this.access.hasMenuAccess(user.id, code))) {
      // Name the section so the message reads as a permissions issue for that
      // feature, not as a claim that the whole menu system is broken.
      const section = code.replace(/^menu:/, '');
      throw new ForbiddenException(
        `Your account does not have access to ${section}. Ask a superadmin to grant it.`,
      );
    }

    return true;
  }
}
