import * as jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import {
  brandNames,
  healthClaims,
  isUrduScript,
  menuTextProblems,
} from './text-rules';
import { bundlePrice, topPairs } from './combos';
import { decodeImage, measure, photoTips, RgbaImage } from './photo-metrics';

/** A test image: `f(x, y)` → grey level. */
export function image(
  w: number,
  h: number,
  f: (x: number, y: number) => number,
): RgbaImage {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = Math.max(0, Math.min(255, Math.round(f(x, y))));
      data.set([v, v, v, 255], (y * w + x) * 4);
    }
  return { width: w, height: h, data };
}

describe('menu text rules', () => {
  it('finds health claims in English and Urdu, as whole words', () => {
    expect(
      healthClaims('A healthy, low-fat karahi that boosts immunity'),
    ).toEqual(['healthy', 'low-fat', 'immunity', 'boosts']);
    expect(healthClaims('صحت کے لیے بہترین')).toEqual(['صحت']);
    expect(
      healthClaims('Smoky tikka with a dieter-free garnish of fresh coriander'),
    ).toEqual([]);
  });

  it('finds brand names; Urdu script check', () => {
    expect(brandNames('Crispier than KFC, with a Pepsi')).toEqual([
      'kfc',
      'pepsi',
    ]);
    expect(brandNames('Coal-fired karahi')).toEqual([]);
    expect(isUrduScript('کوئلے پر پکی خوشبودار چکن کڑاہی')).toBe(true);
    expect(isUrduScript('koylay par paki chicken karahi')).toBe(false);
    expect(menuTextProblems('en', 'Healthy like KFC 🔥')).toHaveLength(3);
  });
});

describe('combos', () => {
  it('counts pairs ordered together, with lift; under 3 orders is not a combo', () => {
    const orders = [
      ['karahi', 'naan'],
      ['karahi', 'naan', 'raita'],
      ['karahi', 'naan'],
      ['biryani', 'raita'],
      ['biryani', 'raita'],
      ['biryani'],
    ];
    expect(topPairs(orders)).toEqual([
      // 3 of 6 orders; P(karahi) = P(naan) = 0.5 → lift 0.5 / 0.25 = 2.
      { items: ['karahi', 'naan'], together: 3, supportPct: 50, lift: 2 },
    ]);
    expect(topPairs(orders, 2).map((p) => p.items)).toEqual([
      ['karahi', 'naan'],
      ['biryani', 'raita'],
    ]);
    expect(topPairs([])).toEqual([]);
  });

  it('bundle price: 10% off, rounded down to Rs 10', () => {
    expect(bundlePrice([1600, 60, 60])).toBe(1540);
  });
});

describe('photo metrics', () => {
  const sharp = image(800, 600, (x, y) =>
    Math.abs(x - 400) < 220 && Math.abs(y - 300) < 160
      ? (Math.floor(x / 8) + Math.floor(y / 8)) % 2
        ? 210
        : 60
      : 128,
  );
  it('a sharp, centred, landscape photo passes', () => {
    const m = measure(sharp);
    expect(m.width).toBe(800);
    expect(m.aspect).toBe(1.33);
    expect(m.sharpness).toBeGreaterThan(1000);
    expect(m.centerFocus).toBeGreaterThan(0.9);
    expect(photoTips(m)).toEqual({ score: 100, problems: [], tips: [] });
  });

  it('dark, blurry, small and portrait photos get one tip each', () => {
    const smooth = image(400, 500, (x, y) => 30 + (x + y) / 40);
    const m = measure(smooth);
    const r = photoTips(m);
    expect(r.problems).toEqual(['dark', 'flat', 'blurry', 'small', 'portrait']);
    expect(r.score).toBe(0);
    expect(photoTips(measure(image(800, 600, () => 240))).problems).toContain(
      'overexposed',
    );
  });

  it('detail only at the edge is off-centre', () => {
    const edge = image(800, 600, (x, y) =>
      x < 120 ? ((Math.floor(x / 6) + Math.floor(y / 6)) % 2 ? 220 : 40) : 128,
    );
    expect(photoTips(measure(edge)).problems).toContain('off_centre');
  });

  it('decodes JPEG and PNG; anything else is null', () => {
    const jpg = jpeg.encode(
      { width: 800, height: 600, data: Buffer.from(sharp.data) },
      90,
    ).data;
    const d = decodeImage(jpg)!;
    expect([d.width, d.height]).toEqual([800, 600]);
    expect(measure(d).sharpness).toBeGreaterThan(500);
    const png = new PNG({ width: 4, height: 3 });
    png.data.fill(255);
    expect(decodeImage(PNG.sync.write(png))).toMatchObject({
      width: 4,
      height: 3,
    });
    expect(decodeImage(Buffer.from('GIF89a…'))).toBeNull();
  });
});
