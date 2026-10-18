import { normalizeText } from '../../../common/text/fuzzy';

/** Number words in Roman Urdu, Urdu script and English. */
const NUMBER_WORDS: Record<string, number> = {
  // Roman Urdu
  ek: 1,
  aik: 1,
  do: 2,
  teen: 3,
  tin: 3,
  char: 4,
  chaar: 4,
  panch: 5,
  paanch: 5,
  panj: 5,
  chay: 6,
  chhe: 6,
  chhay: 6,
  chey: 6,
  che: 6,
  saat: 7,
  sat: 7,
  aath: 8,
  aat: 8,
  nau: 9,
  das: 10,
  dus: 10,
  gyarah: 11,
  gyara: 11,
  barah: 12,
  bara: 12,
  baara: 12,

  terah: 13,
  tera: 13,
  chaudah: 14,
  choda: 14,
  pandrah: 15,
  pandra: 15,
  solah: 16,
  sola: 16,
  satrah: 17,
  satra: 17,
  atharah: 18,
  athara: 18,
  unnees: 19,
  unees: 19,
  bees: 20,
  ikkees: 21,
  bais: 22,
  teis: 23,
  chobees: 24,
  pachees: 25,
  pachis: 25,
  chabbees: 26,
  satais: 27,
  athais: 28,
  untees: 29,
  tees: 30,
  paintees: 35,
  chalees: 40,
  chaalees: 40,
  paintalees: 45,
  pachas: 50,
  pachaas: 50,
  sattar: 70,
  pachattar: 75,
  assi: 80,
  nabbe: 90,
  nawwe: 90,
  // Urdu script
  ایک: 1,
  دو: 2,
  تین: 3,
  چار: 4,
  پانچ: 5,
  چھ: 6,
  سات: 7,
  آٹھ: 8,
  نو: 9,
  دس: 10,
  گیارہ: 11,
  بارہ: 12,
  تیرہ: 13,
  چودہ: 14,
  پندرہ: 15,
  سولہ: 16,
  سترہ: 17,
  اٹھارہ: 18,
  انیس: 19,
  بیس: 20,
  پچیس: 25,
  تیس: 30,
  پینتیس: 35,
  چالیس: 40,
  پینتالیس: 45,
  پچاس: 50,
  ساٹھ: 60,
  ستر: 70,
  پچھتر: 75,
  اسی: 80,
  نوے: 90,
  // English
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
const MULTIPLIERS: Record<string, number> = {
  sau: 100,
  so: 100,
  سو: 100,
  hundred: 100,
  hazaar: 1000,
  hazar: 1000,
  ہزار: 1000,
  thousand: 1000,
};
const FRACTIONS: Record<string, number> = {
  adha: 0.5,
  aadha: 0.5,
  adhaa: 0.5,
  آدھا: 0.5,
  آدھ: 0.5,
  half: 0.5,
  dedh: 1.5,
  dairh: 1.5,
  ڈیڑھ: 1.5,
  dhai: 2.5,
  ڈھائی: 2.5,
};
/** "sawa do" = 2¼, "sarhe teen" = 3½, "paune char" = 3¾. */
const MODIFIERS: Record<string, number> = {
  sawa: 0.25,
  سوا: 0.25,
  sarhe: 0.5,
  sadhe: 0.5,
  ساڑھے: 0.5,
  paune: -0.25,
  پونے: -0.25,
};

/** Canonical unit for a spoken unit word. */
export const UNIT_WORDS: Record<string, string> = {
  kilo: 'kg',
  kilos: 'kg',
  kg: 'kg',
  kgs: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  کلو: 'kg',
  کلوگرام: 'kg',
  gram: 'g',
  grams: 'g',
  gm: 'g',
  g: 'g',

  گرام: 'g',
  litre: 'l',
  liter: 'l',
  litres: 'l',
  liters: 'l',
  ltr: 'l',
  l: 'l',
  لیٹر: 'l',
  ml: 'ml',
  millilitre: 'ml',
  milliliter: 'ml',
  dozen: 'dozen',
  darjan: 'dozen',
  darjen: 'dozen',
  درجن: 'dozen',
  piece: 'piece',
  pieces: 'piece',
  pcs: 'piece',
  pc: 'piece',
  adad: 'piece',
  عدد: 'piece',
  dana: 'piece',
  danay: 'piece',
  packet: 'packet',
  packets: 'packet',
  pack: 'packet',
  پیکٹ: 'packet',
  tray: 'tray',
  trays: 'tray',
  ٹرے: 'tray',
};
export const PRICE_WORDS = new Set([
  'rupay',
  'rupaye',
  'rupees',
  'rupee',
  'rs',
  'rupe',
  'روپے',
  'روپیہ',
  'روپیے',
  'pkr',
]);
export const MINUTE_WORDS = new Set([
  'minute',
  'minutes',
  'min',
  'mins',
  'minat',
  'mint',
  'mnt',
  'منٹ',
]);
export const HOUR_WORDS = new Set([
  'ghanta',
  'ghantay',
  'ghante',
  'hour',
  'hours',
  'گھنٹہ',
  'گھنٹے',
]);

export function tokenize(text: string): string[] {
  return normalizeText(text)
    .replace(/(\d)([a-z؀-ۿ])/g, '$1 $2') // "5kilo" → "5 kilo"
    .split(' ')
    .filter(Boolean);
}

export interface NumberSpan {
  value: number;
  start: number;
  end: number; // exclusive
}

/** Verbs before which "do" is "give/do", not 2: "ready kar do", "de do", "bana do". */
const DO_VERBS = new Set([
  'kar',
  'karr',
  'kr',
  'de',
  'dey',
  'bana',
  'rakh',
  'bata',
  'laga',
  'band',
  'chala',
  'hata',
  'bhej',
  'likh',
  'kardo',
  'kar',
  'کر',
  'دے',
  'بنا',
]);

const numberOf = (t: string): number | null => {
  if (/^\d+(\.\d+)?$/.test(t)) return parseFloat(t);
  if (t in NUMBER_WORDS) return NUMBER_WORDS[t];
  return null;
};

/** Every number in the tokens, multi-word ones combined ("baara sau" = 1200, "ek hazaar do sau" = 1200). */
export function findNumbers(tokens: string[]): NumberSpan[] {
  const out: NumberSpan[] = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if ((t === 'do' || t === 'دو') && i > 0 && DO_VERBS.has(tokens[i - 1])) {
      i++;
      continue;
    }
    const startsNumber =
      numberOf(t) !== null ||
      t in FRACTIONS ||
      (t in MODIFIERS &&
        i + 1 < tokens.length &&
        numberOf(tokens[i + 1]) !== null) ||
      (t in MULTIPLIERS && t !== 'so');
    if (!startsNumber) {
      i++;
      continue;
    }
    const start = i;
    let total = 0;
    let current = 0;
    let modifier = 0;
    let seen = false;
    while (i < tokens.length) {
      const w = tokens[i];
      const n = numberOf(w);
      if (n !== null) {
        current += n;
        seen = true;
      } else if (w in FRACTIONS && !seen) {
        current += FRACTIONS[w];
        seen = true;
      } else if (w in MODIFIERS && !seen) {
        modifier = MODIFIERS[w];
      } else if (w in MULTIPLIERS && (seen || w !== 'so')) {
        current = (current || 1) * MULTIPLIERS[w];
        seen = true;
        if (MULTIPLIERS[w] >= 1000) {
          total += current;
          current = 0;
        }
      } else break;
      i++;
    }
    if (seen) out.push({ value: total + current + modifier, start, end: i });
  }
  return out;
}

export function spokenMinutes(tokens: string[]): number | null {
  const nums = findNumbers(tokens);
  for (const n of nums) {
    const next = tokens[n.end];
    if (next && MINUTE_WORDS.has(next)) return Math.round(n.value);
    if (next && HOUR_WORDS.has(next)) return Math.round(n.value * 60);
  }
  // "aadha ghanta" handled above (fraction + hour); a bare "ghanta" is an hour.
  if (tokens.some((t) => HOUR_WORDS.has(t))) return 60;
  return null;
}
