import { SetMetadata } from '@nestjs/common';
import type { AdminPermission } from '../../types/admin-permissions';

export const PERMISSIONS_KEY = 'adminPermissions';
export const ADMIN_ANY_KEY = 'adminAny';

/**
 * The admin permission(s) a route needs, on top of `@Roles('admin',
 * 'super_admin')`. Every listed key is required. A super admin passes
 * always. PermissionsGuard enforces it from the database-backed user.
 */
export const RequirePermission = (...keys: AdminPermission[]) =>
  SetMetadata(PERMISSIONS_KEY, keys);

/**
 * An admin route that any admin may call (their own TOTP, the console's
 * catalogue). Without this or @RequirePermission an admin route is refused
 * to regular admins: PermissionsGuard fails closed.
 */
export const AdminAny = () => SetMetadata(ADMIN_ANY_KEY, true);
