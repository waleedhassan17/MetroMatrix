import { ForbiddenException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ErrorCode } from '../../../common/errors/codes';

/**
 * There is always at least one active super admin. Called inside the
 * transaction that would disable `losingId`; the advisory lock serialises
 * two such transactions, so they cannot each see the other one remaining.
 */
export async function assertSuperAdminRemains(
  m: EntityManager,
  losingId: string,
): Promise<void> {
  await m.query(
    `SELECT pg_advisory_xact_lock(hashtext('super_admin_invariant'))`,
  );
  const [{ count }] = (await m.query(
    `SELECT count(*)::int AS count FROM users
      WHERE role = 'super_admin' AND status = 'active' AND id <> $1`,
    [losingId],
  )) as Array<{ count: number }>;
  if (count < 1) {
    throw new ForbiddenException({
      code: ErrorCode.LAST_SUPER_ADMIN,
      message: 'There must always be at least one active super admin.',
    });
  }
}
