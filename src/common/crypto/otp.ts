import { createHash, randomInt } from 'crypto';
import { safeEqualHex } from './hash';

/** A 6-digit numeric code from the CSPRNG (never Math.random). */
export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Hash a short code for storage. A 6-digit code has only a million values, so
 * a bare SHA-256 is reversible by enumeration; the server-side pepper (never
 * in the database) and the purpose + owner binding make a leaked row useless
 * on its own and stop one row's hash matching another's.
 */
export function hashCode(
  pepper: string,
  purpose: string,
  ownerId: string,
  code: string,
): string {
  return createHash('sha256')
    .update(`${pepper}:${purpose}:${ownerId}:${code}`)
    .digest('hex');
}

/** Constant-time check of a submitted code against its stored hash. */
export function verifyCode(
  pepper: string,
  purpose: string,
  ownerId: string,
  code: string,
  storedHash: string,
): boolean {
  return safeEqualHex(hashCode(pepper, purpose, ownerId, code), storedHash);
}
