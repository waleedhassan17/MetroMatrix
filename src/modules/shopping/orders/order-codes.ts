import { randomInt } from 'crypto';

/** No 0/O, 1/I/L — codes are read aloud over the phone. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** MM- plus 6 characters: ~887 million codes; a collision is retried by the caller. */
export function newGroupCode(): string {
  let s = 'MM-';
  for (let i = 0; i < 6; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

/** Store orders are numbered within their group: MM-XXXXXX-1, -2, … */
export const storeOrderCode = (groupCode: string, n: number) =>
  `${groupCode}-${n}`;
