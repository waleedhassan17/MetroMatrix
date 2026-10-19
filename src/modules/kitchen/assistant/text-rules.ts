/**
 * The rules every AI-written menu text must pass (and the vendor can rely
 * on): no health or medical claims, no brand or competitor names, Urdu in
 * Urdu script. Pure, so the lists are unit-tested.
 */
const HEALTH_EN = [
  'healthy',
  'healthier',
  'health',
  'nutritious',
  'low fat',
  'low-fat',
  'fat free',
  'fat-free',
  'low calorie',
  'low-calorie',
  'sugar free',
  'sugar-free',
  'diet',
  'diabetic',
  'cholesterol',
  'weight loss',
  'lose weight',
  'detox',
  'immunity',
  'immune',
  'cure',
  'cures',
  'heal',
  'healing',
  'medicinal',
  'digestion',
  'boosts',
  'superfood',
  'guilt-free',
  'guilt free',
];
const HEALTH_UR = [
  'صحت',
  'صحتمند',
  'شفا',
  'علاج',
  'ڈائٹ',
  'وزن کم',
  'قوت مدافعت',
  'ہاضم',
  'شوگر فری',
];
const BRANDS = [
  'kfc',
  "mcdonald's",
  'mcdonalds',
  'pizza hut',
  'subway',
  "domino's",
  'dominos',
  "hardee's",
  'hardees',
  'burger king',
  'starbucks',
  "nando's",
  'nandos',
  'optp',
  'cheezious',
  'kababjees',
  'savour foods',
  'student biryani',
  'howdy',
  'johnny rockets',
  'tim hortons',
  'coca-cola',
  'coca cola',
  'coke',
  'pepsi',
  'nestle',
  'shan masala',
  'national foods',
];

const lower = (s: string) => s.toLowerCase();
const wordRe = (w: string) =>
  new RegExp(
    `(^|[^\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`,
    'u',
  );

export function healthClaims(text: string): string[] {
  const t = lower(text);
  return [
    ...HEALTH_EN.filter((w) => wordRe(w).test(t)),
    ...HEALTH_UR.filter((w) => text.includes(w)),
  ];
}

export function brandNames(text: string): string[] {
  const t = lower(text);
  return BRANDS.filter((w) => wordRe(w).test(t));
}

/** Urdu script: letters are Arabic-script (Latin letters allowed for at most 10% of them). */
export function isUrduScript(text: string): boolean {
  const letters = [...text].filter((c) => /\p{L}/u.test(c));
  if (letters.length < 3) return false;
  const arabic = letters.filter((c) => /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/.test(c));
  return arabic.length / letters.length >= 0.9;
}

/** Every problem with a menu text, for the AI check (and the retry it triggers). */
export function menuTextProblems(field: string, text: string): string[] {
  const out: string[] = [];
  const h = healthClaims(text);
  if (h.length) out.push(`${field}: no health claims (${h.join(', ')})`);
  const b = brandNames(text);
  if (b.length) out.push(`${field}: no brand names (${b.join(', ')})`);
  if (/[\u{1F300}-\u{1FAFF}]|#\w/u.test(text))
    out.push(`${field}: no emojis or hashtags`);
  return out;
}
