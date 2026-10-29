import { randomInt } from 'crypto';
import { PASSWORD_REGEX } from '../validation/password';

// No 0/O, 1/l/I: read aloud or off a screen without mistakes.
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghjkmnpqrstuvwxyz';
const DIGITS = '23456789';
const ALL = UPPER + LOWER + DIGITS;

const pick = (set: string) => set[randomInt(set.length)];

/**
 * A temporary password for a new or reset admin: 16 characters from a CSPRNG
 * (about 92 bits), always meeting the password policy. Shown once; only its
 * bcrypt hash is stored, and the admin must replace it at first sign-in.
 */
export function temporaryPassword(length = 16): string {
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS)];
  while (chars.length < length) chars.push(pick(ALL));
  // Fisher–Yates, so the guaranteed classes are not always first.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  const password = chars.join('');
  if (!PASSWORD_REGEX.test(password)) throw new Error('unreachable');
  return password;
}
