import { EntityManager } from 'typeorm';
import { unitPrice, variantLabel } from '../common/catalog-sql';

/** The store-level facts a cart, preview or checkout needs. */
export interface CartStore {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  ownerUserId: string;
  /** Approved business and not paused. */
  isOpen: boolean;
  pauseMessage: string | null;
  shippingFlatFee: number;
  freeShippingOver: number | null;
  codEnabled: boolean;
  codLimit: number;
  deliveryCities: string[];
  returnWindowDays: number;
}

/** One cart line joined to its live variant, product and store. */
export interface CartLine {
  cartItemId: string;
  quantity: number;
  priceAtAdd: number;
  addedAt: Date;
  variantId: string;
  variantLabel: string;
  stock: number;
  productId: string;
  productName: string;
  imageUrl: string | null;
  /** The live unit price: (sale ?? base) + variant delta. */
  unitPrice: number;
  /** Product published and variant still sold. */
  isAvailable: boolean;
  store: CartStore;
}

/**
 * Load a cart's lines. With `lock`, the variant rows are locked FOR UPDATE in
 * ascending id order — the one lock order every stock writer uses, so two
 * checkouts can never deadlock — and the result is then re-sorted for display.
 */
export async function loadCartLines(
  m: EntityManager,
  cartId: string,
  opts: { lock?: boolean } = {},
): Promise<CartLine[]> {
  const rows: any[] = await m.query(
    `SELECT ci.id AS cart_item_id, ci.quantity, ci.price_at_add, ci.created_at AS added_at,
            v.id AS variant_id, v.option1, v.option2, v.price_delta, v.stock, v.is_active AS variant_active,
            p.id AS product_id, p.name AS product_name, p.status AS product_status,
            p.base_price, p.sale_price,
            (SELECT i.url FROM product_images i WHERE i.product_id = p.id ORDER BY i.sort, i.created_at LIMIT 1) AS image_url,
            s.id AS store_id, s.slug AS store_slug, b.name AS store_name, s.logo_url,
            b.owner_user_id, (s.is_paused = false AND b.status = 'approved') AS store_open,
            s.pause_message, s.shipping_flat_fee, s.free_shipping_over, s.cod_enabled, s.cod_limit,
            s.delivery_cities, s.return_window_days
       FROM cart_items ci
       JOIN product_variants v ON v.id = ci.variant_id
       JOIN products p ON p.id = v.product_id
       JOIN stores s ON s.id = p.store_id
       JOIN businesses b ON b.id = s.business_id
      WHERE ci.cart_id = $1
      ${opts.lock ? 'ORDER BY v.id FOR UPDATE OF v' : 'ORDER BY ci.created_at, ci.id'}`,
    [cartId],
  );
  const stores = new Map<string, CartStore>();
  const lines = rows.map((r): CartLine => {
    let store = stores.get(r.store_id);
    if (!store) {
      store = {
        id: r.store_id,
        slug: r.store_slug,
        name: r.store_name,
        logoUrl: r.logo_url,
        ownerUserId: r.owner_user_id,
        isOpen: r.store_open,
        pauseMessage: r.pause_message,
        shippingFlatFee: r.shipping_flat_fee,
        freeShippingOver: r.free_shipping_over,
        codEnabled: r.cod_enabled,
        codLimit: r.cod_limit,
        deliveryCities: r.delivery_cities ?? [],
        returnWindowDays: r.return_window_days,
      };
      stores.set(r.store_id, store);
    }
    return {
      cartItemId: r.cart_item_id,
      quantity: r.quantity,
      priceAtAdd: r.price_at_add,
      addedAt: r.added_at,
      variantId: r.variant_id,
      variantLabel: variantLabel(r),
      stock: r.stock,
      productId: r.product_id,
      productName: r.product_name,
      imageUrl: r.image_url,
      unitPrice: unitPrice(
        { basePrice: r.base_price, salePrice: r.sale_price },
        { priceDelta: r.price_delta },
      ),
      isAvailable: r.product_status === 'active' && r.variant_active,
      store,
    };
  });
  if (opts.lock) {
    lines.sort(
      (a, b) =>
        a.addedAt.getTime() - b.addedAt.getTime() ||
        a.cartItemId.localeCompare(b.cartItemId),
    );
  }
  return lines;
}

/** Lines grouped by store, stores in the order their first line was added. */
export function groupByStore(
  lines: CartLine[],
): Array<{ store: CartStore; lines: CartLine[] }> {
  const groups = new Map<string, { store: CartStore; lines: CartLine[] }>();
  for (const l of lines) {
    const g = groups.get(l.store.id) ?? { store: l.store, lines: [] };
    g.lines.push(l);
    groups.set(l.store.id, g);
  }
  return [...groups.values()];
}

/** Delivery cities match case- and space-insensitively; none listed = nationwide. */
export function deliversTo(store: CartStore, city: string): boolean {
  if (!store.deliveryCities.length) return true;
  const want = city.trim().toLowerCase();
  return store.deliveryCities.some((c) => c.trim().toLowerCase() === want);
}
