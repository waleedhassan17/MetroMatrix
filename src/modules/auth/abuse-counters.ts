import { DataSource, EntityManager } from 'typeorm';

/**
 * Per-account failure counters (users.signin_failures / totp_failures), for
 * limits that must hold across instances and IPs — the route Throttler is in
 * memory per instance and keyed by IP, so it can't.
 *
 * A window starts at the first failure and lasts WINDOW_MINUTES; a failure
 * after it ends starts a new one. Counting is one atomic UPDATE … RETURNING,
 * so concurrent wrong guesses all count.
 */
export const WINDOW_MINUTES = 15;
const WINDOW_MS = WINDOW_MINUTES * 60_000;

export type FailureKind = 'signin' | 'totp';

// Column names are fixed here, never taken from input.
const COLUMNS: Record<FailureKind, { count: string; since: string }> = {
  signin: { count: 'signin_failures', since: 'signin_failures_since' },
  totp: { count: 'totp_failures', since: 'totp_failures_since' },
};

type Db = DataSource | EntityManager;

/** Count one failure; returns the count in the current window. */
export async function recordFailure(
  db: Db,
  userId: string,
  kind: FailureKind,
): Promise<{ count: number; since: Date }> {
  const { count, since } = COLUMNS[kind];
  const fresh = `${since} IS NULL OR ${since} < now() - interval '${WINDOW_MINUTES} minutes'`;
  const rows: { count: number; since: Date }[] = await db.query(
    `UPDATE users
        SET ${count} = CASE WHEN ${fresh} THEN 1 ELSE ${count} + 1 END,
            ${since} = CASE WHEN ${fresh} THEN now() ELSE ${since} END
      WHERE id = $1
      RETURNING ${count} AS count, ${since} AS since`,
    [userId],
  );
  // TypeORM's postgres driver answers [rows, affected] for UPDATE … RETURNING.
  const row = (Array.isArray(rows[0]) ? rows[0][0] : rows[0]) as
    { count: number; since: Date } | undefined;
  return {
    count: Number(row?.count ?? 0),
    since: new Date(row?.since ?? Date.now()),
  };
}

export async function resetFailures(
  db: Db,
  userId: string,
  kind: FailureKind,
): Promise<void> {
  const { count, since } = COLUMNS[kind];
  await db.query(
    `UPDATE users SET ${count} = 0, ${since} = NULL WHERE id = $1 AND ${count} <> 0`,
    [userId],
  );
}

/**
 * Seconds until the window ends when `max` failures are already in it,
 * otherwise 0 (not locked).
 */
export function lockedForSeconds(
  failures: number,
  since: Date | null,
  max: number,
  now = Date.now(),
): number {
  if (!since || failures < max) return 0;
  const left = since.getTime() + WINDOW_MS - now;
  return left > 0 ? Math.ceil(left / 1000) : 0;
}
