import { normalizeText, similarity } from '../../../common/text/fuzzy';
import type { VoiceIntent, VoiceLine } from './voice.types';

export const NAME_OK = 0.6;

/** alias → canonical (ingredient_aliases), so "ٹماٹر" counts for "tamatar". */
export type AliasMap = Map<string, string>;

export function aliasMap(
  rows: Array<[string, string[], string[], string[]]>,
): AliasMap {
  const m: AliasMap = new Map();
  for (const [c, en, roman, ur] of rows)
    for (const a of [c, ...en, ...roman, ...ur]) m.set(normalizeText(a), c);
  return m;
}

const canonOf = (name: string, aliases?: AliasMap): string | null => {
  if (!aliases) return null;
  const n = normalizeText(name);
  if (aliases.has(n)) return aliases.get(n)!;
  for (const w of n.split(' ')) if (aliases.has(w)) return aliases.get(w)!;
  return null;
};

/** A name is right when it is close to any accepted spelling, or the same ingredient. */
export function nameMatches(
  want: string | string[],
  got: string | undefined,
  aliases?: AliasMap,
): boolean {
  if (!got) return false;
  const options = Array.isArray(want) ? want : [want];
  if (options.some((w) => similarity(w, got) >= NAME_OK)) return true;
  const g = canonOf(got, aliases);
  return !!g && options.some((w) => canonOf(w, aliases) === g);
}

/**
 * Scoring for the voice accuracy set (voice-eval/manifest.json): the intent
 * must match; every expected slot must be right (numbers exactly, names at
 * similarity ≥ 0.6, lines in order). Extra slots don't count against.
 */
export interface ExpectedReading {
  intent: string;
  /** Names may list accepted spellings: { "dish": ["biryani", "بریانی"] }. */
  slots: Record<string, unknown>;
}

export interface Score {
  intent: boolean;
  full: boolean;
  misses: string[];
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.011;

function lineMisses(
  want: VoiceLine,
  got: VoiceLine | undefined,
  i: number,
  aliases?: AliasMap,
): string[] {
  if (!got) return [`lines[${i}] missing`];
  const out: string[] = [];
  if (!nameMatches(want.name, got.name, aliases))
    out.push(`lines[${i}].name ${got.name}≠${want.name}`);
  for (const k of ['qty', 'totalPrice', 'expiresInDays'] as const)
    if (
      want[k] !== undefined &&
      (got[k] === undefined || !near(want[k]!, got[k]!))
    )
      out.push(`lines[${i}].${k} ${got[k]}≠${want[k]}`);
  if (want.unit !== undefined && got.unit !== want.unit)
    out.push(`lines[${i}].unit ${got.unit}≠${want.unit}`);
  return out;
}

export function scoreReading(
  want: ExpectedReading,
  got: VoiceIntent | null,
  aliases?: AliasMap,
): Score {
  if (!got) return { intent: false, full: false, misses: ['no reading'] };
  const misses: string[] = [];
  if (got.intent !== want.intent)
    misses.push(`intent ${got.intent}≠${want.intent}`);
  const s = (got.slots ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(want.slots)) {
    const g = s[k];
    if (k === 'lines') {
      const lines = v as VoiceLine[];
      const gl = (g as VoiceLine[] | undefined) ?? [];
      if (gl.length !== lines.length)
        misses.push(`lines ${gl.length}≠${lines.length}`);
      lines.forEach((l, i) => misses.push(...lineMisses(l, gl[i], i, aliases)));
    } else if (typeof v === 'number') {
      if (typeof g !== 'number' || !near(g, v)) misses.push(`${k} ${g}≠${v}`);
    } else if (typeof v === 'boolean') {
      if (g !== v) misses.push(`${k} ${g}≠${v}`);
    } else if (k === 'orderCode') {
      if (String(g ?? '').toUpperCase() !== String(v).toUpperCase())
        misses.push(`${k} ${g}≠${v}`);
    } else if (
      !nameMatches(v as string | string[], g as string | undefined, aliases)
    )
      misses.push(`${k} ${g}≠${JSON.stringify(v)}`);
  }
  return {
    intent: got.intent === want.intent,
    full: misses.length === 0,
    misses,
  };
}
