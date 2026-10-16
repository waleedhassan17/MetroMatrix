import { normalise } from './red-flags';

export interface KeywordData {
  specialties: Array<{
    id: string;
    slug: string;
    name: string;
    keywords: string[];
  }>;
  conditions: Array<{
    id: string;
    name: string;
    aliases: string[];
    specialtySlug: string;
  }>;
}

export interface KeywordMatch {
  ranked: string[];
  conditions: Array<{ id: string; name: string }>;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-word phrase match on normalised text; tolerates a plural "s"/"es". */
function phraseRe(phrase: string): RegExp | null {
  const p = normalise(phrase);
  if (p.length < 3) return null;
  return new RegExp(`(?:^| )${escapeRe(p)}(?:s|es)?(?= |$)`);
}

/**
 * The offline matcher (ported from the FYP's keyword map, now driven by the
 * reference tables): condition names and aliases score 2 for their
 * first-choice specialty, specialty keywords score 1.
 */
export function matchKeywords(text: string, data: KeywordData): KeywordMatch {
  const t = normalise(text);
  const score = new Map<string, number>();
  const add = (slug: string, n: number) =>
    score.set(slug, (score.get(slug) ?? 0) + n);
  const conditions: KeywordMatch['conditions'] = [];
  for (const c of data.conditions) {
    const hit = [c.name, ...c.aliases].some((p) => phraseRe(p)?.test(t));
    if (hit) {
      add(c.specialtySlug, 2);
      conditions.push({ id: c.id, name: c.name });
    }
  }
  for (const s of data.specialties) {
    const hits = [s.name, ...s.keywords].filter((p) => phraseRe(p)?.test(t));
    if (hits.length) add(s.slug, hits.length);
  }
  const order = new Map(data.specialties.map((s, i) => [s.slug, i]));
  const ranked = [...score.entries()]
    .sort(
      (a, b) =>
        b[1] - a[1] || (order.get(a[0]) ?? 999) - (order.get(b[0]) ?? 999),
    )
    .map(([slug]) => slug);
  return { ranked, conditions: conditions.slice(0, 5) };
}

const SOON =
  /(?:^| )(?:severe|very bad|worst|high fever|getting worse|for (?:a|one|two|2) weeks?|bohat (?:zyada|ziada|tez)|shadeed|tez bukhar|barhta ja raha)(?= |$)/;

/** A cautious urgency for the offline path: "soon" on signs of severity, else routine. */
export const keywordUrgency = (text: string) =>
  SOON.test(normalise(text)) ? ('soon' as const) : ('routine' as const);
