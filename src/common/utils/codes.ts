import { randomInt } from 'crypto';

/** No 0/O, 1/I/L — codes are read aloud over the phone. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * PREFIX- plus 6 characters (~887 million codes): MM-7KQ2PX for shopping
 * orders, HC-4TR9WA for appointments. Callers insert with ON CONFLICT DO
 * NOTHING and retry on the rare collision.
 */
export function newCode(prefix: string): string {
  let s = `${prefix}-`;
  for (let i = 0; i < 6; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

/** Shopping order groups: MM-XXXXXX. */
export const newGroupCode = (): string => newCode('MM');

/** Store orders are numbered within their group: MM-XXXXXX-1, -2, … */
export const storeOrderCode = (groupCode: string, n: number) =>
  `${groupCode}-${n}`;
