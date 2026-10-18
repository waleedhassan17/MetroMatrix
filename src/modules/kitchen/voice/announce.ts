/**
 * The spoken new-order announcement, from templates (no model): the app
 * reads `text` with the device's voice, or plays `ttsUrl` when Google TTS
 * is on (TTS_PROVIDER=google). Pure, so it is unit-tested.
 */

export type AnnounceLang = 'ur' | 'roman' | 'en';

export interface AnnounceOrder {
  code: string;
  fulfilment: 'delivery' | 'pickup';
  scheduledFor: string | null;
  paymentMethod: string;
  total: number;
  items: Array<{
    name: string;
    nameUr: string | null;
    quantity: number;
    variant: string | null;
  }>;
}

const URDU_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const urduDigits = (s: string) =>
  s.replace(/\d/g, (d) => URDU_DIGITS[Number(d)]);
const rupees = (n: number) => n.toLocaleString('en-PK');
/** "FC-7KQ2PX" read letter by letter: "F C 7 K Q 2 P X". */
export const spellCode = (code: string) =>
  code.replace(/^FC-/, '').split('').join(' ');

const PAY: Record<AnnounceLang, Record<string, string>> = {
  en: {
    cod: 'cash',
    pay_at_pickup: 'pay at pickup',
    transfer: 'bank transfer',
  },
  roman: {
    cod: 'cash',
    pay_at_pickup: 'pickup par payment',
    transfer: 'bank transfer',
  },
  ur: {
    cod: 'کیش',
    pay_at_pickup: 'پک اپ پر ادائیگی',
    transfer: 'بینک ٹرانسفر',
  },
};

const WORDS: Record<AnnounceLang, string[]> = {
  en: [
    'zero',
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
  ],
  roman: [
    'sifar',
    'ek',
    'do',
    'teen',
    'char',
    'panch',
    'chay',
    'saat',
    'aath',
    'nau',
    'das',
  ],
  ur: [
    'صفر',
    'ایک',
    'دو',
    'تین',
    'چار',
    'پانچ',
    'چھ',
    'سات',
    'آٹھ',
    'نو',
    'دس',
  ],
};
/** Quantities are spoken as words up to ten ("do chicken biryani"). */
const count = (n: number, lang: AnnounceLang) =>
  n <= 10 ? WORDS[lang][n] : lang === 'ur' ? urduDigits(String(n)) : String(n);

/**
 * "Naya order: do Chicken Biryani, ek Raita, delivery, cash. Total 1,250
 * rupay. Order 7 K Q 2 P X." — at most four lines, then how many more.
 */
export function announcementText(o: AnnounceOrder, lang: AnnounceLang): string {
  const shown = o.items.slice(0, 4);
  const more = o.items.length - shown.length;
  const code = spellCode(o.code);
  const pay = PAY[lang][o.paymentMethod] ?? o.paymentMethod;
  const name = (i: AnnounceOrder['items'][number]) =>
    `${lang === 'ur' ? i.nameUr || i.name : i.name}${i.variant ? ` (${i.variant})` : ''}`;
  const lines = shown.map((i) => `${count(i.quantity, lang)} ${name(i)}`);
  if (lang === 'ur') {
    const kind = o.fulfilment === 'pickup' ? 'پک اپ' : 'ڈیلیوری';
    const rest = more > 0 ? `، اور ${urduDigits(String(more))} مزید` : '';
    return `نیا ${o.scheduledFor ? 'پری ' : ''}آرڈر: ${lines.join('، ')}${rest}، ${kind}، ${pay}۔ کل ${urduDigits(rupees(o.total))} روپے۔ آرڈر ${code}۔`;
  }
  if (lang === 'roman') {
    const rest = more > 0 ? `, aur ${more} mazeed` : '';
    return `Naya ${o.scheduledFor ? 'pre-' : ''}order: ${lines.join(', ')}${rest}, ${o.fulfilment}, ${pay}. Total ${rupees(o.total)} rupay. Order ${code}.`;
  }
  const rest = more > 0 ? `, and ${more} more` : '';
  return `New ${o.scheduledFor ? 'pre-' : ''}order: ${lines.join(', ')}${rest}, ${o.fulfilment}, ${pay}. Total ${rupees(o.total)} rupees. Order ${code}.`;
}
