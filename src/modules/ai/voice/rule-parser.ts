import { normalizeText } from '../../../common/text/fuzzy';
import {
  MINUTE_WORDS,
  PRICE_WORDS,
  UNIT_WORDS,
  findNumbers,
  spokenMinutes,
  tokenize,
} from './lexicon';
import type { VoiceContext, VoiceIntent, VoiceLine } from './voice.types';

/**
 * The deterministic reading of a transcript — the fallback when the model's
 * intent is unusable, and the baseline in the voice eval. Keyword rules for
 * Roman Urdu, Urdu script and English; it never guesses an action it can't
 * see words for (→ unknown).
 */

const has = (text: string, words: string[]): boolean =>
  words.some((w) => text.includes(w));

const ACCEPT = [
  'accept',
  'qabool',
  'qubool',
  'kabool',
  'قبول',
  'manzoor',
  'منظور',
  'le lo',
  'le lein',
  'le lain',
  'order lo',
  'okay order',
  'confirm',
];
const REJECT = [
  'reject',
  'decline',
  'mana kar',
  'inkaar',
  'inkar',
  'انکار',
  'منع',
  'nahi le sakte',
  'nahin le sakte',
  'cancel kar',
  'refuse',
];
const READY = [
  'ready',
  'tayyar',
  'tayar',
  'taiyar',
  'تیار',
  'ban gaya',
  'ban gya',
  'pack ho gaya',
  'pack kar diya',
];
const FINISHED = [
  'khatam',
  'khtam',
  'ختم',
  'finished',
  'is over',
  'sold out',
  'out of',
  'nahi raha',
  'nahi rahi',
  'unavailable',
  'not available',
  'band kar do',
  'bik gaya',
  'bik gai',
];
const BUSY = [
  'busy',
  'masroof',
  'masruf',
  'مصروف',
  'rush',
  'bheer',
  'bheed',
  'رش',
];
const PORTIONS = [
  'portion',
  'portions',
  'hisse',
  'hissay',
  'حصے',
  'plate',
  'plates',
  'servings',
  'serving',
  'پلیٹ',
  'پلیٹیں',
];
const NOT_COOKING = [
  'not cooking',
  'no cooking',
  'nahi bana',
  'nahin bana',
  'nahi pak',
  'chutti',
  'chhutti',
  'چھٹی',
  'نہیں بنا',
  'kitchen band',
  'closed today',
];
const COOKING = [
  'cooking today',
  'bana rahe',
  'bana rahi',
  'pak raha',
  'pakaa rahe',
  'kitchen khol',
  'open today',
  'بنا رہے',
  'بنا رہی',
];
const WASTE = [
  'waste',
  'kharab',
  'kharaab',
  'خراب',
  'zaya',
  'zaaya',
  'ضائع',
  'spoiled',
  'spoilt',
  'expired',
  'expire',
  'phenk',
  'پھینک',
  'throw',
  'jal gaya',
  'burnt',
  'burned',
  'bach gaya',
  'leftover',
];
const COUNT = [
  'count',
  'ginti',
  'گنتی',
  'bacha',
  'bachi',
  'bache',
  'baqi',
  'باقی',
  'بچا',
  'remaining',
  'left',
  'stock hai',
  'in stock',
];
const BUY = [
  'khareeda',
  'kharida',
  'khareedi',
  'kharidi',
  'خریدا',
  'خریدی',
  'bought',
  'purchase',
  'purchased',
  'liya',
  'liye',
  'li ',
  'لیا',
  'لیے',
  'aaya',
  'aya',
  'aaye',
];

const STOP = new Set([
  'add',
  'rahe',
  'rahi',
  'raha',
  'we',
  'are',
  'our',
  'this',
  'ye',
  'yeh',
  'in',
  'got',
  'away',
  'tak',
  'by',
  'with',
  'ka',
  'ki',
  'ke',
  'ko',
  'hai',
  'hain',
  'ho',
  'gaya',
  'gai',
  'gaye',
  'gya',
  'kar',
  'karo',
  'do',
  'de',
  'diya',
  'dein',
  'please',
  'plz',
  'the',
  'a',
  'an',
  'is',
  'are',
  'of',
  'for',
  'to',
  'it',
  'its',
  'set',
  'mark',
  'now',
  'abhi',
  'aaj',
  'ab',
  'bhai',
  'yaar',
  'jee',
  'ji',
  'order',
  'aur',
  'and',
  'phir',
  'wala',
  'wali',
  'wale',
  'mein',
  'me',
  'se',
  'ne',
  'liye',
  'liya',
  'li',
  'total',
  'worth',
  'k',
  'کا',
  'کی',
  'کے',
  'کو',
  'ہے',
  'ہیں',
  'ہو',
  'گیا',
  'گئی',
  'کر',
  'کرو',
  'دو',
  'دیا',
  'اور',
  'میں',
  'سے',
  'نے',
  'آج',
  'اب',
]);

/** The words left once intent words, numbers and stop-words are removed — the dish or ingredient name. */
function residue(tokens: string[], drop: string[]): string {
  const dropWords = new Set(drop.flatMap((d) => d.split(' ')));
  return tokens
    .filter(
      (t) =>
        !STOP.has(t) &&
        !dropWords.has(t) &&
        !/^\d+(\.\d+)?$/.test(t) &&
        !(t in UNIT_WORDS) &&
        !PRICE_WORDS.has(t) &&
        !MINUTE_WORDS.has(t),
    )
    .filter((t) => findNumbers([t]).length === 0)
    .join(' ')
    .trim();
}

const ORDER_CODE = /\bfc[\s-]?([a-z2-9]{6})\b/i;

const DAY_WORDS = new Set(['din', 'day', 'days', 'دن']);
const WEEK = ['agle hafte', 'next week', 'ek hafta', 'ہفتے', 'a week'];

/** "3 din", "teen days", "agle hafte tak" → days until it expires. */
function expiryOf(tokens: string[], text: string): number | undefined {
  for (const n of findNumbers(tokens))
    if (DAY_WORDS.has(tokens[n.end] ?? '')) return Math.round(n.value);
  if (has(` ${text} `, WEEK)) return 7;
  if (has(` ${text} `, ['kal tak', 'by tomorrow'])) return 1;
  return undefined;
}

function lineOf(segment: string): VoiceLine | null {
  const tokens = tokenize(segment);
  const nums = findNumbers(tokens).filter(
    (n) => !DAY_WORDS.has(tokens[n.end] ?? ''),
  );
  if (!nums.length) return null;
  let unit: string | undefined;
  let qty: number | undefined;
  let price: number | undefined;
  for (const n of nums) {
    const next = tokens[n.end];
    const prev = tokens[n.start - 1];
    if ((next && PRICE_WORDS.has(next)) || (prev && PRICE_WORDS.has(prev)))
      price = n.value;
    else if (next && next in UNIT_WORDS && qty === undefined) {
      qty = n.value;
      unit = UNIT_WORDS[next];
    }
  }
  const unpriced = nums.filter((n) => n.value !== price && n.value !== qty);
  if (qty === undefined && unpriced.length) qty = unpriced.shift()!.value;
  if (price === undefined && unpriced.length)
    price = unpriced[unpriced.length - 1].value;
  const name = residue(tokens, BUY.concat(WASTE, COUNT, ['expire', 'expires']));
  if (!name) return null;
  return {
    name,
    ...(qty !== undefined ? { qty } : {}),
    ...(unit ? { unit } : {}),
    ...(price !== undefined ? { totalPrice: price } : {}),
  };
}

const SPLIT = /\s(?:aur|and|phir|then|اور)\s|[,،]/;

/**
 * One line per item. A clause that is only a price ("…, aath sau rupay")
 * or only an expiry ("…, agle hafte tak") belongs to the line before it.
 */
function linesOf(text: string): VoiceLine[] {
  const out: VoiceLine[] = [];
  for (const seg of text.split(SPLIT)) {
    const tokens = tokenize(seg);
    const days = expiryOf(tokens, normalizeText(seg));
    const last = out[out.length - 1];
    if (days !== undefined && !tokens.some((t) => t in UNIT_WORDS)) {
      if (last) last.expiresInDays = days;
      continue;
    }
    const line = lineOf(seg);
    if (line) {
      if (days !== undefined) line.expiresInDays = days;
      out.push(line);
      continue;
    }
    const priced = findNumbers(tokens).find(
      (n) =>
        PRICE_WORDS.has(tokens[n.end] ?? '') ||
        PRICE_WORDS.has(tokens[n.start - 1] ?? ''),
    );
    if (priced && last && last.totalPrice === undefined)
      last.totalPrice = priced.value;
  }
  return out;
}

function wasteReason(text: string): string {
  if (has(text, ['expire', 'expired', 'mud', 'date guzar'])) return 'expired';
  if (has(text, ['jal', 'burnt', 'burned', 'overcooked', 'zyada pak']))
    return 'overcooked';
  if (has(text, ['bach gaya', 'leftover', 'bacha hua'])) return 'leftover';
  if (has(text, ['wapas', 'returned', 'return'])) return 'returned';
  if (has(text, ['kharab', 'kharaab', 'خراب', 'spoil', 'sar gaya', 'باسی']))
    return 'spoiled';
  return 'other';
}

export function parseVoiceText(
  context: VoiceContext,
  raw: string,
): VoiceIntent {
  const text = ` ${normalizeText(raw)} `;
  const tokens = tokenize(raw);
  const unknown: VoiceIntent = { intent: 'unknown', slots: {} };
  if (!tokens.length) return unknown;
  const code = ORDER_CODE.exec(text)?.[1]?.toUpperCase();
  const orderCode = code ? `FC-${code}` : undefined;

  switch (context) {
    case 'board': {
      // An explicit reject wins: "reject kar do kyunke chicken khatam hai".
      if (has(text, REJECT)) {
        const why =
          /(?:kyunke|kyun ke|kyunki|because|کیونکہ|wajah)\s+(.+)$/.exec(
            text.trim(),
          );
        return {
          intent: 'reject',
          slots: {
            ...(orderCode ? { orderCode } : {}),
            ...(why ? { reason: why[1].trim() } : {}),
          },
        };
      }
      if (has(text, FINISHED)) {
        const dish = residue(tokens, FINISHED);
        return dish ? { intent: 'mark_unavailable', slots: { dish } } : unknown;
      }
      if (has(text, ACCEPT)) {
        const eta = spokenMinutes(tokens);
        return {
          intent: 'accept',
          slots: {
            ...(orderCode ? { orderCode } : {}),
            ...(eta ? { etaMinutes: eta } : {}),
          },
        };
      }
      if (has(text, READY))
        return {
          intent: 'mark_ready',
          slots: { ...(orderCode ? { orderCode } : {}) },
        };
      if (has(text, BUSY))
        return {
          intent: 'busy',
          slots: { minutes: spokenMinutes(tokens) ?? 15 },
        };
      return unknown;
    }
    case 'today': {
      if (has(text, NOT_COOKING)) {
        const dish = residue(
          tokens,
          NOT_COOKING.concat(COOKING, ['kitchen', 'today']),
        );
        return {
          intent: 'cooking_today',
          slots: { on: false, ...(dish ? { dish } : {}) },
        };
      }
      if (has(text, COOKING) && !has(text, PORTIONS))
        return { intent: 'cooking_today', slots: { on: true } };
      const nums = findNumbers(tokens);
      if (nums.length && (has(text, PORTIONS) || tokens.length <= 6)) {
        const dish = residue(tokens, PORTIONS.concat(COOKING));
        if (dish)
          return {
            intent: 'set_portions',
            slots: { dish, count: Math.round(nums[nums.length - 1].value) },
          };
      }
      return unknown;
    }
    case 'stock':
    case 'purchase': {
      if (has(text, WASTE)) {
        const [line] = linesOf(raw);
        return line
          ? {
              intent: 'log_waste',
              slots: { lines: [line], reason: wasteReason(text) },
            }
          : unknown;
      }
      if (context === 'stock' && has(text, COUNT) && !has(text, BUY)) {
        const [line] = linesOf(raw);
        return line
          ? {
              intent: 'count',
              slots: {
                lines: [{ name: line.name, qty: line.qty, unit: line.unit }],
              },
            }
          : unknown;
      }
      const lines = linesOf(raw);
      return lines.length
        ? { intent: 'add_purchase', slots: { lines } }
        : unknown;
    }
    case 'menu_search':
    case 'food_search': {
      const filler = [
        'the',
        'a',
        'kuch',
        'khana',
        'khaana',
        'karo',
        'please',
        'mujhe',
        'muje',
        'dikhao',
        'dikha',
        'chahiye',
        'chaiye',
        'search',
        'find',
        'show',
        'me',
        'dhoondo',
        'dhundo',
        'order',
        'karna',
        'hai',
        'want',
        'i',
        'some',
        'near',
        'nearby',
        'paas',
        'mere',
        'مجھے',
        'دکھاؤ',
        'چاہیے',
      ];
      const query = tokens
        .filter((t) => !filler.includes(t))
        .join(' ')
        .trim();
      return query ? { intent: 'search', slots: { query } } : unknown;
    }
    case 'pantry': {
      const lines = linesOf(raw);
      return lines.length
        ? { intent: 'add_pantry', slots: { lines } }
        : unknown;
    }
  }
}
