/**
 * The one definition of "a customer may see this" — used by every catalogue,
 * cart and checkout query so they can never disagree:
 *   the business is approved (not pending/suspended), the store is not
 *   paused, and the product is published (`active`; never `removed`).
 *
 * Expects the aliases p (products), s (stores), b (businesses).
 */
export const VISIBLE_STORE_SQL = `s.is_paused = false AND b.status = 'approved'`;
export const VISIBLE_PRODUCT_SQL = `p.status = 'active' AND ${VISIBLE_STORE_SQL}`;

export const PRODUCT_FROM_SQL = `
  FROM products p
  JOIN stores s ON s.id = p.store_id
  JOIN businesses b ON b.id = s.business_id`;

/** Positional-parameter collector (shared; re-exported for Shopping's imports). */
export { SqlParams } from '../../../common/utils/sql-params';

/** Escape LIKE wildcards in user input before wrapping it in %…%. */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Effective unit price: sale price when set, else base, plus the variant delta. */
export const unitPrice = (
  product: { basePrice: number; salePrice: number | null },
  variant: { priceDelta: number },
): number => (product.salePrice ?? product.basePrice) + variant.priceDelta;

/** "M / Maroon", or "Default" for a product without options. */
export const variantLabel = (v: {
  option1: string | null;
  option2: string | null;
}) => [v.option1, v.option2].filter(Boolean).join(' / ') || 'Default';

/** Customers see stock as flags, never numbers. */
export const LOW_STOCK_THRESHOLD = 3;
