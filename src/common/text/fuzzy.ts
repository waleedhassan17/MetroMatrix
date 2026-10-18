/**
 * Small, dependency-free fuzzy matching for spoken or typed names
 * ("biriyani" ≈ "Chicken Biryani"). Trigram Dice similarity on a normalised
 * form; word containment scores as a strong match.
 */

const URDU_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

export function normalizeText(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[۰-۹]/g, (d) => String(URDU_DIGITS.indexOf(d)))
    .toLowerCase()
    .replace(/[ً-ٰٟ]/g, '') // Arabic-script diacritics
    .replace(/[،۔؟!?.,;:"'`()[\]{}\-_/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const trigrams = (s: string): Set<string> => {
  const t = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
  return out;
};

/** 0..1 — Dice coefficient over trigrams, boosted when one is a whole-word part of the other. */
export function similarity(a: string, b: string): number {
  const x = normalizeText(a);
  const y = normalizeText(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const words = (s: string) => ` ${s} `;
  if (words(y).includes(words(x)) || words(x).includes(words(y))) {
    const shorter = Math.min(x.length, y.length);
    const longer = Math.max(x.length, y.length);
    return Math.max(0.75, shorter / longer);
  }
  const A = trigrams(x);
  const B = trigrams(y);
  let common = 0;
  for (const g of A) if (B.has(g)) common++;
  return (2 * common) / (A.size + B.size);
}

export interface Candidate<T> {
  value: T;
  names: string[];
}

/** The best candidate at or above `min`, the runner-ups, and whether the top is clear. */
export function bestMatch<T>(
  query: string,
  candidates: Candidate<T>[],
  min = 0.45,
): {
  best: { value: T; score: number } | null;
  others: Array<{ value: T; score: number }>;
} {
  const scored = candidates
    .map((c) => ({
      value: c.value,
      score: Math.max(0, ...c.names.map((n) => similarity(query, n))),
    }))
    .filter((c) => c.score >= min)
    .sort((a, b) => b.score - a.score);
  return { best: scored[0] ?? null, others: scored.slice(1, 4) };
}
