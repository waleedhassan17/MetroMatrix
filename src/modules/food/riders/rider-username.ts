/**
 * Rider usernames — ported from FinMatrix-Backend `delivery-personnel/rider-username.ts`.
 *
 * A rider signs in with a username and a password issued by their vendor;
 * there is no self-service recovery, so the username is the ONLY way in and
 * every path that creates a rider must name it here.
 *
 * Shape: `<brand-slug>.<first-name>` (then `2`, `3`… on a clash). The brand
 * prefix makes a clash between two vendors' "imran" impossible rather than
 * merely unlikely; `users.username` is globally unique (citext).
 */
import type { EntityManager } from 'typeorm';

/** Leaves room for a numeric suffix within 64 characters. */
const MAX_BASE_LENGTH = 58;
const MIN_LENGTH = 3;
const MAX_ATTEMPTS = 1000;
/** Kept short so the whole handle stays easy to type on a phone. */
const MAX_PREFIX_LENGTH = 24;

/** Lower-case a–z/0–9 only; accents folded ("Imran Alí" → "imranali"). */
export const slugifyRiderName = (raw: string | null | undefined): string =>
  (raw ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** A brand slug ("karahi-house-lahore") kept as a readable prefix ("karahi-house-lahore" → hyphens allowed). */
const prefixOf = (brandSlug: string | null | undefined) =>
  (brandSlug ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, MAX_PREFIX_LENGTH)
    .replace(/-$/, '');

export const buildRiderUsernameBase = (args: {
  brandSlug?: string | null;
  fullName?: string | null;
}): string => {
  const code = prefixOf(args.brandSlug) || 'rider';
  const who =
    slugifyRiderName((args.fullName ?? '').trim().split(/\s+/)[0]) || 'rider';
  let base = `${code}.${who}`.slice(0, MAX_BASE_LENGTH).replace(/[._-]+$/, '');
  while (base.length < MIN_LENGTH) base += '0';
  return base;
};

/** The first free username at or after `base`: base, base2, base3… */
export const allocateRiderUsername = async (
  em: EntityManager,
  base: string,
): Promise<string> => {
  for (let n = 1; n <= MAX_ATTEMPTS; n += 1) {
    const candidate = n === 1 ? base : `${base}${n}`;
    const taken: unknown[] = await em.query(
      'SELECT 1 FROM users WHERE username = $1 LIMIT 1',
      [candidate],
    );
    if (!taken.length) return candidate;
  }
  throw new Error(`Could not allocate a rider username from base "${base}".`);
};

/** Riders have no mailbox: a reserved, never-delivered address (RFC 2606 `.invalid`). */
export const riderEmail = (username: string) =>
  `${username}@riders.metromatrix.invalid`;
