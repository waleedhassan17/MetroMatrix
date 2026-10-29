import { SERVICE_TYPES, ServiceType } from '../businesses/business-types';

export const BROADCAST_AUDIENCES = [
  'all',
  'customers',
  'partners',
  'riders',
] as const;
export type BroadcastAudience = (typeof BROADCAST_AUDIENCES)[number];

/** For GET /admin/meta: who a broadcast can reach. */
export const BROADCAST_AUDIENCE_INFO = [
  { key: 'all', label: 'Everyone', description: 'Every active account.' },
  { key: 'customers', label: 'Customers', description: 'Every customer.' },
  {
    key: 'partners',
    label: 'Partners',
    description:
      'Partners with an approved business; pick a service to narrow it.',
    services: [...SERVICE_TYPES],
  },
  { key: 'riders', label: 'Riders', description: 'Every active rider.' },
];

/**
 * The condition that picks the audience's users (alias `u`, named params):
 * active accounts only, and for partners an approved business (in
 * `service`, when given).
 */
export function audienceWhere(
  audience: BroadcastAudience,
  service: ServiceType | null,
): { sql: string; params: Record<string, unknown> } {
  switch (audience) {
    case 'all':
      return { sql: `u.status = 'active'`, params: {} };
    case 'customers':
      return { sql: `u.status = 'active' AND u.role = 'customer'`, params: {} };
    case 'riders':
      return { sql: `u.status = 'active' AND u.role = 'rider'`, params: {} };
    case 'partners':
      return {
        sql: `u.status = 'active' AND u.role = 'partner' AND EXISTS (
                SELECT 1 FROM businesses b WHERE b.owner_user_id = u.id
                   AND b.status = 'approved'${service ? ' AND b.service_type = :service' : ''})`,
        params: service ? { service } : {},
      };
  }
}
