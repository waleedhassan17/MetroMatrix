/** Card fields every product list shares. Expects p, s, b aliases. */
export const PRODUCT_CARD_COLUMNS = `
  p.id, p.name, p.slug, p.base_price, p.sale_price,
  COALESCE(p.sale_price, p.base_price) AS price,
  p.rating_avg, p.rating_count, p.sold_count, p.published_at,
  s.id AS store_id, s.slug AS store_slug, b.name AS store_name,
  (SELECT i.url FROM product_images i WHERE i.product_id = p.id ORDER BY i.sort, i.created_at LIMIT 1) AS cover_url,
  EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.is_active AND v.stock > 0) AS in_stock`;

export interface ProductCard {
  id: string;
  name: string;
  slug: string;
  price: number;
  basePrice: number;
  salePrice: number | null;
  onSale: boolean;
  coverUrl: string | null;
  ratingAvg: number;
  ratingCount: number;
  inStock: boolean;
  isWishlisted?: boolean;
  store: { id: string; slug: string; name: string };
}

export const productCard = (r: any): ProductCard => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  price: r.price,
  basePrice: r.base_price,
  salePrice: r.sale_price,
  onSale: r.sale_price !== null,
  coverUrl: r.cover_url,
  ratingAvg: parseFloat(r.rating_avg),
  ratingCount: r.rating_count,
  inStock: r.in_stock,
  store: { id: r.store_id, slug: r.store_slug, name: r.store_name },
});
