import * as jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

/**
 * Menu-photo quality, measured without AI: brightness, contrast, sharpness
 * (variance of the Laplacian), how much of the detail sits in the middle,
 * size and shape. Pure (jpeg-js / pngjs decode), so thresholds are tested.
 */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface PhotoMetrics {
  width: number;
  height: number;
  /** Mean luma, 0–255. */
  brightness: number;
  /** Luma standard deviation. */
  contrast: number;
  /** Variance of the Laplacian on a ≤ 512 px greyscale copy; low = blurry. */
  sharpness: number;
  /** Share of the edge energy in the middle 60% × 60% (≈ 0.36 when spread evenly). */
  centerFocus: number;
  aspect: number;
}

export const PHOTO_LIMITS = {
  darkBelow: 70,
  brightAbove: 205,
  flatBelow: 25,
  blurryBelow: 60,
  offCentreBelow: 0.3,
  smallBelow: 600,
};

export function decodeImage(bytes: Buffer): RgbaImage | null {
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      const img = jpeg.decode(bytes, {
        useTArray: true,
        maxResolutionInMP: 40,
        maxMemoryUsageInMB: 512,
      });
      return { width: img.width, height: img.height, data: img.data };
    }
    if (
      bytes[0] === 0x89 &&
      bytes.subarray(1, 4).toString('latin1') === 'PNG'
    ) {
      const p = PNG.sync.read(bytes);
      return { width: p.width, height: p.height, data: p.data };
    }
  } catch {
    return null;
  }
  return null;
}

/** Greyscale, box-averaged down so the longer side is at most `max`. */
function grey(img: RgbaImage, max = 512) {
  const scale = Math.max(1, Math.ceil(Math.max(img.width, img.height) / max));
  const w = Math.floor(img.width / scale);
  const h = Math.floor(img.height / scale);
  const g = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++) {
          const i = ((y * scale + dy) * img.width + (x * scale + dx)) * 4;
          sum +=
            0.299 * img.data[i] +
            0.587 * img.data[i + 1] +
            0.114 * img.data[i + 2];
        }
      g[y * w + x] = sum / (scale * scale);
    }
  return { g, w, h };
}

export function measure(img: RgbaImage): PhotoMetrics {
  const { g, w, h } = grey(img);
  let sum = 0;
  for (const v of g) sum += v;
  const mean = sum / g.length;
  let sq = 0;
  for (const v of g) sq += (v - mean) ** 2;
  // Laplacian (4-neighbour) and gradient energy, skipping the border.
  let lapSum = 0;
  let lapSq = 0;
  let n = 0;
  let energy = 0;
  let centre = 0;
  const [x0, x1, y0, y1] = [w * 0.2, w * 0.8, h * 0.2, h * 0.8];
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const c = g[y * w + x];
      const lap =
        g[y * w + x - 1] +
        g[y * w + x + 1] +
        g[(y - 1) * w + x] +
        g[(y + 1) * w + x] -
        4 * c;
      lapSum += lap;
      lapSq += lap * lap;
      n++;
      const gx = g[y * w + x + 1] - g[y * w + x - 1];
      const gy = g[(y + 1) * w + x] - g[(y - 1) * w + x];
      const e = Math.sqrt(gx * gx + gy * gy);
      energy += e;
      if (x >= x0 && x < x1 && y >= y0 && y < y1) centre += e;
    }
  const lapMean = n ? lapSum / n : 0;
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    width: img.width,
    height: img.height,
    brightness: r1(mean),
    contrast: r1(Math.sqrt(sq / g.length)),
    sharpness: r1(n ? lapSq / n - lapMean * lapMean : 0),
    centerFocus: energy ? Math.round((centre / energy) * 100) / 100 : 0,
    aspect: Math.round((img.width / img.height) * 100) / 100,
  };
}

/** Plain tips for each problem found, and a 0–100 score (20 off per problem). */
export function photoTips(m: PhotoMetrics) {
  const L = PHOTO_LIMITS;
  const problems: Array<{ key: string; tip: string }> = [];
  if (m.brightness < L.darkBelow)
    problems.push({
      key: 'dark',
      tip: 'Too dark — shoot near a window in daylight, without the flash.',
    });
  else if (m.brightness > L.brightAbove)
    problems.push({
      key: 'overexposed',
      tip: 'Overexposed — move out of direct sun or a bright lamp.',
    });
  if (m.contrast < L.flatBelow)
    problems.push({
      key: 'flat',
      tip: 'Looks flat — use a plate or background that contrasts with the food.',
    });
  if (m.sharpness < L.blurryBelow)
    problems.push({
      key: 'blurry',
      tip: 'Looks blurry — hold the phone steady and tap the dish to focus.',
    });
  if (m.centerFocus < L.offCentreBelow)
    problems.push({
      key: 'off_centre',
      tip: 'The dish looks small or off-centre — move closer and fill the frame.',
    });
  if (Math.min(m.width, m.height) < L.smallBelow)
    problems.push({
      key: 'small',
      tip: 'Small photo — use at least 1200 × 900 pixels.',
    });
  if (m.aspect < 1)
    problems.push({
      key: 'portrait',
      tip: 'Turn the phone sideways: a landscape (4:3) photo fills the dish card.',
    });
  else if (m.aspect > 2)
    problems.push({ key: 'too_wide', tip: 'Too wide — crop closer to 4:3.' });
  return {
    score: Math.max(0, 100 - 20 * problems.length),
    problems: problems.map((p) => p.key),
    tips: problems.map((p) => p.tip),
  };
}
