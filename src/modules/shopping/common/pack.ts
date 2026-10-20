/**
 * Pack size for grocery products (Chunk 5, My Kitchen): "1 kg", "500 ml",
 * "12 pieces". A variant's pack overrides the product's. Price per unit is
 * what the missing-to-bag compare sorts by. Pure.
 */
export const PACK_UNITS = ['g', 'kg', 'ml', 'l', 'piece', 'dozen'] as const;
export type PackUnit = (typeof PACK_UNITS)[number];

export interface Pack {
  qty: number;
  unit: PackUnit;
}

/** The pack in kg, l or pieces — the unit prices are compared in. */
export function packIn(p: Pack): { qty: number; per: 'kg' | 'l' | 'piece' } {
  switch (p.unit) {
    case 'g':
      return { qty: p.qty / 1000, per: 'kg' };
    case 'kg':
      return { qty: p.qty, per: 'kg' };
    case 'ml':
      return { qty: p.qty / 1000, per: 'l' };
    case 'l':
      return { qty: p.qty, per: 'l' };
    case 'dozen':
      return { qty: p.qty * 12, per: 'piece' };
    default:
      return { qty: p.qty, per: 'piece' };
  }
}

/** Rs per kg / l / piece, to 2 decimals; null without a pack. */
export function pricePerUnit(
  price: number,
  pack: Pack | null,
): { price: number; per: 'kg' | 'l' | 'piece' } | null {
  if (!pack || !(pack.qty > 0)) return null;
  const { qty, per } = packIn(pack);
  return { price: Math.round((price / qty) * 100) / 100, per };
}

/** The variant's pack, else the product's. */
export const effectivePack = (
  product: { packQty: number | null; packUnit: string | null },
  variant?: { packQty: number | null; packUnit: string | null } | null,
): Pack | null => {
  const src =
    variant && variant.packQty !== null && variant.packUnit ? variant : product;
  return src.packQty !== null && src.packUnit
    ? { qty: Number(src.packQty), unit: src.packUnit as PackUnit }
    : null;
};
