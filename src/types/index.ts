/**
 * Shared enums and types used across modules.
 */

export const USER_ROLES = [
  'customer',
  'partner',
  // Reserved for the Food chunk: riders get a username and their own app.
  'rider',
  'admin',
  'super_admin',
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ADMIN_ROLES: readonly UserRole[] = ['admin', 'super_admin'];
export const isAdminRole = (role: UserRole): boolean =>
  ADMIN_ROLES.includes(role);

export const USER_STATUSES = ['active', 'disabled', 'deleted'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];
