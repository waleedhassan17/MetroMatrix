import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/** Hex SHA-256. Used for high-entropy secrets (refresh/reset tokens) at rest. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** URL-safe random token, e.g. an opaque refresh token. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Constant-time comparison of two hex digests. */
export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && ab.length > 0 && timingSafeEqual(ab, bb);
}
