/**
 * What a regular admin may be granted. A super admin holds every one of them
 * implicitly, plus admin management, which is not in this list on purpose:
 * it can never be granted to an admin.
 *
 * Stored per admin in `users.admin_permissions` (jsonb array). The CHECK on
 * that column is generated from this list, so adding a key needs a migration.
 */
export const ADMIN_PERMISSION_KEYS = [
  'approvePartners',
  'manageUsers',
  'manageShopping',
  'manageHealthcare',
  'manageFood',
  'manageKitchen',
  'manageContent',
  'viewAnalytics',
  'broadcast',
  'viewAudit',
  'manageSettings',
] as const;
export type AdminPermission = (typeof ADMIN_PERMISSION_KEYS)[number];

export const isAdminPermission = (key: string): key is AdminPermission =>
  (ADMIN_PERMISSION_KEYS as readonly string[]).includes(key);

export const ADMIN_PERMISSION_GROUPS = [
  { key: 'operations', label: 'Operations' },
  { key: 'services', label: 'Services' },
  { key: 'insight', label: 'Insight' },
  { key: 'platform', label: 'Platform' },
] as const;
export type AdminPermissionGroup =
  (typeof ADMIN_PERMISSION_GROUPS)[number]['key'];

export interface AdminPermissionInfo {
  key: AdminPermission;
  group: AdminPermissionGroup;
  label: string;
  description: string;
}

/** Labels for the console's permission editor (GET /admin/meta). */
export const ADMIN_PERMISSION_CATALOGUE: readonly AdminPermissionInfo[] = [
  {
    key: 'approvePartners',
    group: 'operations',
    label: 'Approve partners',
    description:
      'Review partner businesses: approve, reject, suspend and reinstate.',
  },
  {
    key: 'manageUsers',
    group: 'operations',
    label: 'Manage people',
    description:
      'Search accounts, disable and enable them, sign them out everywhere.',
  },
  {
    key: 'manageShopping',
    group: 'services',
    label: 'Shopping',
    description:
      'Categories, featured stores, reports, product removal, orders and reviews.',
  },
  {
    key: 'manageHealthcare',
    group: 'services',
    label: 'Healthcare',
    description:
      'Doctors (PMDC checks, listing), specialties, conditions, appointments and reviews.',
  },
  {
    key: 'manageFood',
    group: 'services',
    label: 'Food',
    description:
      'Vendors, orders, reviews, cuisines, plans, safety checks and growth tools.',
  },
  {
    key: 'manageKitchen',
    group: 'services',
    label: 'Kitchen and AI',
    description:
      'Ingredient aliases, reference prices, nutrition data and AI usage.',
  },
  {
    key: 'manageContent',
    group: 'services',
    label: 'Banners',
    description: 'Home banners in Shopping, Healthcare and Food.',
  },
  {
    key: 'viewAnalytics',
    group: 'insight',
    label: 'Analytics',
    description: 'The overview and the analytics charts.',
  },
  {
    key: 'viewAudit',
    group: 'insight',
    label: 'Audit log',
    description: 'Who changed what, and when.',
  },
  {
    key: 'broadcast',
    group: 'platform',
    label: 'Broadcasts',
    description: 'Send push notifications to customers, partners or riders.',
  },
  {
    key: 'manageSettings',
    group: 'platform',
    label: 'Settings',
    description: 'Feature flags: signups, services, AI and maintenance mode.',
  },
];

/** What an account may actually do: everything for a super admin. */
export function effectivePermissions(user: {
  role: string;
  adminPermissions?: readonly string[] | null;
}): AdminPermission[] {
  if (user.role === 'super_admin') return [...ADMIN_PERMISSION_KEYS];
  if (user.role !== 'admin') return [];
  return ADMIN_PERMISSION_KEYS.filter((k) =>
    (user.adminPermissions ?? []).includes(k),
  );
}
