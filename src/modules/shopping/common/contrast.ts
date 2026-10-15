/**
 * Brand colours must stay readable: a store's colour is used as a button and
 * header background with text on it. WCAG 2.x AA for normal text is 4.5:1.
 */

export const WHITE = '#FFFFFF';
/** MetroMatrix ink. */
export const INK = '#16151A';
export const AA_CONTRAST = 4.5;

export const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of `#RRGGBB`. */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The text colour to put on `brandColor` — white or ink, whichever reads
 * better — or null when neither reaches AA (the colour is refused).
 */
export function onBrandColor(brandColor: string): string | null {
  const white = contrastRatio(brandColor, WHITE);
  const ink = contrastRatio(brandColor, INK);
  const best =
    white >= ink ? { color: WHITE, ratio: white } : { color: INK, ratio: ink };
  return best.ratio >= AA_CONTRAST ? best.color : null;
}
