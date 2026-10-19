import type { BaseUnit } from '../stock/units';

/**
 * The SPI import format. PBS publishes the weekly Sensitive Price Indicator
 * as a PDF (city prices in Appendix-A), with no CSV or API, so staff
 * transcribe the rows they need into this template:
 *
 *   week_ending,city,item,unit,price
 *   2026-10-15,Lahore,Tomatoes,kg,180
 *
 * Pure: parsing and unit reading are unit-tested.
 */
export const SPI_HEADER = [
  'week_ending',
  'city',
  'item',
  'unit',
  'price',
] as const;

export interface SpiRow {
  line: number;
  weekEnding: string;
  city: string;
  item: string;
  unit: string;
  price: number;
}

/** RFC 4180-ish: commas, double quotes, "" escapes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export function readSpi(text: string): {
  rows: SpiRow[];
  errors: Array<{ line: number; error: string }>;
} {
  const all = parseCsv(text.replace(/^﻿/, ''));
  const errors: Array<{ line: number; error: string }> = [];
  if (!all.length)
    return { rows: [], errors: [{ line: 1, error: 'empty file' }] };
  const header = all[0].map((h) => h.trim().toLowerCase());
  const idx = SPI_HEADER.map((h) => header.indexOf(h));
  if (idx.some((i) => i < 0))
    return {
      rows: [],
      errors: [{ line: 1, error: `header must be ${SPI_HEADER.join(',')}` }],
    };
  const rows: SpiRow[] = [];
  all.slice(1).forEach((r, k) => {
    const line = k + 2;
    const [week, city, item, unit, price] = idx.map((i) => (r[i] ?? '').trim());
    const p = Number(price.replace(/[,\s]/g, '').replace(/^rs\.?/i, ''));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || isNaN(Date.parse(week)))
      errors.push({ line, error: 'week_ending must be YYYY-MM-DD' });
    else if (!city || city.length > 60)
      errors.push({ line, error: 'city is required' });
    else if (!item || item.length > 120)
      errors.push({ line, error: 'item is required' });
    else if (!spiUnit(unit))
      errors.push({
        line,
        error: `unit "${unit}" isn't one we can compare (kg, g, litre, ml, dozen, piece)`,
      });
    else if (!(p > 0) || p > 1_000_000)
      errors.push({ line, error: 'price must be a positive number of rupees' });
    else
      rows.push({
        line,
        weekEnding: week,
        city,
        item,
        unit,
        price: Math.round(p * 100) / 100,
      });
  });
  return { rows, errors };
}

/** "kg", "2.5 kg", "250 grams", "litre", "dozen", "each" → base unit and how many base units one is. */
export function spiUnit(
  unit: string,
): { baseUnit: BaseUnit; factor: number } | null {
  const u = unit.trim().toLowerCase().replace(/\s+/g, ' ');
  const m =
    /^(\d+(?:\.\d+)?)?\s*(kg|kgs|kilo|kilogram|kilograms|g|gm|gms|gram|grams|l|ltr|litre|litres|liter|liters|ml|dozen|doz|piece|pieces|pcs|pc|each|no|nos|number)$/.exec(
      u,
    );
  if (!m) return null;
  const n = m[1] ? Number(m[1]) : 1;
  const w = m[2];
  if (['kg', 'kgs', 'kilo', 'kilogram', 'kilograms'].includes(w))
    return { baseUnit: 'g', factor: n * 1000 };
  if (['g', 'gm', 'gms', 'gram', 'grams'].includes(w))
    return { baseUnit: 'g', factor: n };
  if (['l', 'ltr', 'litre', 'litres', 'liter', 'liters'].includes(w))
    return { baseUnit: 'ml', factor: n * 1000 };
  if (w === 'ml') return { baseUnit: 'ml', factor: n };
  if (['dozen', 'doz'].includes(w))
    return { baseUnit: 'piece', factor: n * 12 };
  return { baseUnit: 'piece', factor: n };
}
