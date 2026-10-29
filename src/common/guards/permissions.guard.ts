import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ROLES_KEY, UserRole } from '../decorators/roles.decorator';
import {
  ADMIN_ANY_KEY,
  PERMISSIONS_KEY,
} from '../decorators/require-permission.decorator';
import { AuthenticatedUser } from '../decorators/current-user.decorator';
import { ErrorCode } from '../errors/codes';
import type { AdminPermission } from '../../types/admin-permissions';

const forbidden = () =>
  new ForbiddenException({
    code: ErrorCode.FORBIDDEN,
    message: 'You do not have permission to perform this action.',
  });

/**
 * Global, after RolesGuard. Applies only to routes a regular admin may reach
 * (`@Roles` lists 'admin'):
 *
 * - a super admin always passes;
 * - `@RequirePermission(...)` → the admin must hold every key;
 * - `@AdminAny()` → any admin;
 * - neither → refused. Fail closed: a new admin route nobody mapped is
 *   super-admin-only until it is given a permission.
 *
 * Permissions come from `req.user`, which AccessTokenValidator builds from
 * the users row on every request — never from the token.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const roles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      targets,
    );
    if (!roles?.includes('admin')) return true;

    const user = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>().user;
    if (!user) throw forbidden();
    if (user.role === 'super_admin') return true;
    if (user.role !== 'admin') throw forbidden();

    const required = this.reflector.getAllAndOverride<AdminPermission[]>(
      PERMISSIONS_KEY,
      targets,
    );
    if (required?.length) {
      const held = user.adminPermissions ?? [];
      if (required.every((k) => held.includes(k))) return true;
      throw forbidden();
    }
    if (this.reflector.getAllAndOverride<boolean>(ADMIN_ANY_KEY, targets)) {
      return true;
    }
    throw forbidden();
  }
}
