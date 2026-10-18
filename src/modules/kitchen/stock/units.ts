import { BadRequestException } from '@nestjs/common';
import { ErrorCode } from '../../../common/errors/codes';
import { normalizeText } from '../../../common/text/fuzzy';

/**
 * The one place quantities convert. Ingredients are stored in a base unit
 * (g, ml or piece); kg/l/dozen convert by fixed factors, and each ingredient
 * may add its own units ("tray" = 30 eggs, "packet" = 500 g). Pure.
 */
export const BASE_UNITS = ['g', 'ml', 'piece'] as const;
export type BaseUnit = (typeof BASE_UNITS)[number];

export interface CustomUnit {
  /** "tray", "packet", "bori" — lowercase. */
  name: string;
  /** How many base units one of it is. */
  factor: number;
}

export interface UnitOwner {
  baseUnit: BaseUnit;
  customUnits: CustomUnit[];
}

const STANDARD: Record<string, { base: BaseUnit; factor: number }> = {
  g: { base: 'g', factor: 1 },
  kg: { base: 'g', factor: 1000 },
  ml: { base: 'ml', factor: 1 },
  l: { base: 'ml', factor: 1000 },
  piece: { base: 'piece', factor: 1 },
  dozen: { base: 'piece', factor: 12 },
};

/** Spellings people type or say → the standard unit. */
const SPELLINGS: Record<string, string> = {
  gram: 'g',
  grams: 'g',
  gm: 'g',
  gms: 'g',
  گرام: 'g',
  kilo: 'kg',
  kilos: 'kg',
  kgs: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  کلو: 'kg',
  millilitre: 'ml',
  milliliter: 'ml',
  litre: 'l',
  liter: 'l',
  litres: 'l',
  liters: 'l',
  ltr: 'l',
  لیٹر: 'l',
  pieces: 'piece',
  pc: 'piece',
  pcs: 'piece',
  adad: 'piece',
  عدد: 'piece',
  darjan: 'dozen',
  درجن: 'dozen',
};

export const canonicalUnit = (unit: string): string => {
  const u = normalizeText(unit);
  return SPELLINGS[u] ?? u;
};

/** The units this ingredient can be counted in. */
export function unitsFor(i: UnitOwner): string[] {
  const std = Object.entries(STANDARD)
    .filter(([, s]) => s.base === i.baseUnit)
    .map(([u]) => u);
  return [...std, ...i.customUnits.map((c) => c.name)];
}

export const unitMismatch = (unit: string, i: UnitOwner) =>
  new BadRequestException({
    code: ErrorCode.UNIT_MISMATCH,
    message: `“${unit}” doesn't fit an ingredient counted in ${i.baseUnit}.`,
    details: { unit, baseUnit: i.baseUnit, allowed: unitsFor(i) },
  });

/** Base units per one `unit`, or null when it doesn't fit this ingredient. */
export function factorOf(unit: string, i: UnitOwner): number | null {
  const u = canonicalUnit(unit);
  const custom = i.customUnits.find((c) => c.name === u);
  if (custom) return custom.factor;
  const std = STANDARD[u];
  return std && std.base === i.baseUnit ? std.factor : null;
}

/** qty × unit → base units (3 decimals). Throws 400 UNIT_MISMATCH. */
export function toBase(qty: number, unit: string, i: UnitOwner): number {
  const f = factorOf(unit, i);
  if (f === null) throw unitMismatch(unit, i);
  return round3(qty * f);
}

export const round3 = (n: number) => Math.round(n * 1000) / 1000;
export const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** Base units → the friendliest standard unit (5000 g → 5 kg, 18 piece → 1.5 dozen stays pieces). */
export function display(
  qtyBase: number,
  base: BaseUnit,
): { qty: number; unit: string } {
  const abs = Math.abs(qtyBase);
  if (base === 'g' && abs >= 1000)
    return { qty: round3(qtyBase / 1000), unit: 'kg' };
  if (base === 'ml' && abs >= 1000)
    return { qty: round3(qtyBase / 1000), unit: 'l' };
  return { qty: round3(qtyBase), unit: base };
}

/** Rupees per base unit → per the unit people buy in (per kg, per l, per piece). */
export function pricePer(
  costPerBase: number,
  base: BaseUnit,
): { price: number; per: string } {
  if (base === 'g') return { price: Math.round(costPerBase * 1000), per: 'kg' };
  if (base === 'ml') return { price: Math.round(costPerBase * 1000), per: 'l' };
  return { price: Math.round(costPerBase * 100) / 100, per: 'piece' };
}
