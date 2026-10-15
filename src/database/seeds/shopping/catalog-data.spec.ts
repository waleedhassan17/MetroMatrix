import { readFileSync } from 'fs';
import { join } from 'path';
import { DEMO_BANNERS, DEMO_STORES } from './catalog-data';
import { placeholdUrl, tileSvg } from './tiles';
import { onBrandColor } from '../../../modules/shopping/common/contrast';
import {
  buildPkIban,
  normalizeAccountNumber,
} from '../../../modules/shopping/common/payment-account.validation';
import { slugify } from '../../../modules/businesses/businesses.service';

describe('shopping demo catalogue', () => {
  const taxonomy = readFileSync(
    join(__dirname, '../../migrations/1792065738567-ShopCategoriesSeed.ts'),
    'utf8',
  );

  it('four stores with 15–25 valid products each', () => {
    expect(DEMO_STORES.map((s) => s.key).sort()).toEqual([
      'beauty',
      'fashion',
      'handmade',
      'home',
    ]);
    for (const s of DEMO_STORES) {
      expect(s.products.length).toBeGreaterThanOrEqual(15);
      expect(s.products.length).toBeLessThanOrEqual(25);
      expect(onBrandColor(s.brandColor)).not.toBeNull();
      expect(s.coupons).toHaveLength(2);
      const slugs = s.products.map((p) => slugify(p.name));
      expect(new Set(slugs).size).toBe(slugs.length);
      for (const p of s.products) {
        expect(Number.isInteger(p.basePrice)).toBe(true);
        if (p.salePrice !== undefined)
          expect(p.salePrice).toBeLessThan(p.basePrice);
        expect(taxonomy).toContain(`'${p.category}'`);
        if (p.collection) expect(s.collections).toContain(p.collection);
      }
      for (const a of s.accounts) {
        const raw =
          a.kind === 'bank'
            ? buildPkIban(...(a.number.split(':') as [string, string]))
            : a.number;
        expect(normalizeAccountNumber(a.kind, raw).ok).toBe(true);
      }
    }
    expect(DEMO_BANNERS).toHaveLength(3);
    for (const b of DEMO_BANNERS) {
      const t = b.target;
      if (t.type === 'category')
        expect(taxonomy).toContain(`slug: '${t.category}'`);
      if (t.type === 'collection') {
        expect(
          DEMO_STORES.find((s) => s.key === t.store)!.collections,
        ).toContain(t.collection);
      }
    }
  });

  it('tiles escape their text and placeholder URLs are deterministic', () => {
    const svg = tileSvg({
      title: 'Salt & <Pepper>',
      bg: '#7F1D1D',
      fg: '#FFFFFF',
      motif: 'dots',
    });
    expect(svg).toContain('Salt &amp; &lt;Pepper&gt;');
    expect(svg).not.toContain('<Pepper>');
    expect(placeholdUrl('Blue pottery mug', '#B45309', '#FFFFFF')).toBe(
      'https://placehold.co/800x800/B45309/FFFFFF/png?text=Blue+pottery+mug',
    );
  });
});
