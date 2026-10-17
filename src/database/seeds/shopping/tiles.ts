import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { join } from 'path';
import { v2 as cloudinary } from 'cloudinary';
import { uploadFolder } from '../../../modules/media/asset-url';

/**
 * Seed images. No stock photos, no licensing questions: every product and
 * store gets a generated tile (its brand colour, a pattern, its name). A
 * licensed photo dropped into seed/assets/shopping/<store>/<slug>.(jpg|png|webp)
 * replaces the tile on the next seed (see that folder's README).
 *
 * With Cloudinary keys, images are uploaded into the owner's own media folder
 * (so they pass the same ownership checks as the partner's uploads) and served
 * as PNG. Without keys — local development only — deterministic placehold.co
 * URLs stand in.
 */

export type Motif = 'stripes' | 'dots' | 'waves' | 'diamonds';

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

/** Break a name into at most three lines of ~16 characters. */
function lines(text: string, width = 16): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if ((line + ' ' + word).trim().length > width && line) {
      out.push(line);
      line = word;
    } else {
      line = (line + ' ' + word).trim();
    }
  }
  if (line) out.push(line);
  return out.slice(0, 3);
}

function pattern(motif: Motif, fg: string): string {
  const o = 'opacity="0.14"';
  switch (motif) {
    case 'stripes':
      return `<pattern id="p" width="40" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="14" height="40" fill="${fg}" ${o}/></pattern>`;
    case 'dots':
      return `<pattern id="p" width="36" height="36" patternUnits="userSpaceOnUse"><circle cx="18" cy="18" r="6" fill="${fg}" ${o}/></pattern>`;
    case 'waves':
      return `<pattern id="p" width="80" height="40" patternUnits="userSpaceOnUse"><path d="M0 20 Q20 0 40 20 T80 20" stroke="${fg}" stroke-width="5" fill="none" ${o}/></pattern>`;
    case 'diamonds':
      return `<pattern id="p" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M24 4 L44 24 L24 44 L4 24 Z" fill="none" stroke="${fg}" stroke-width="4" ${o}/></pattern>`;
  }
}

/** A square (or wide) SVG tile: brand colour, pattern, title, small caption. */
export function tileSvg(opts: {
  title: string;
  caption?: string;
  bg: string;
  fg: string;
  motif: Motif;
  width?: number;
  height?: number;
}): string {
  const w = opts.width ?? 800;
  const h = opts.height ?? 800;
  const text = lines(opts.title, w > h ? 28 : 16);
  const size = w > h ? 64 : 72;
  const top = h / 2 - ((text.length - 1) * size * 1.15) / 2;
  const tspans = text
    .map(
      (t, i) =>
        `<text x="${w / 2}" y="${top + i * size * 1.15}" font-size="${size}">${escape(t)}</text>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs>${pattern(opts.motif, opts.fg)}</defs>
<rect width="${w}" height="${h}" fill="${opts.bg}"/>
<rect width="${w}" height="${h}" fill="url(#p)"/>
<g fill="${opts.fg}" font-family="Georgia, 'Times New Roman', serif" font-weight="700" text-anchor="middle" dominant-baseline="middle">${tspans}</g>
${opts.caption ? `<text x="${w / 2}" y="${h - 56}" fill="${opts.fg}" font-family="Helvetica, Arial, sans-serif" font-size="28" letter-spacing="6" text-anchor="middle" opacity="0.8">${escape(opts.caption.toUpperCase())}</text>` : ''}
</svg>`;
}

export function placeholdUrl(
  title: string,
  bg: string,
  fg: string,
  width = 800,
  height = 800,
): string {
  const hex = (c: string) => c.replace('#', '').toUpperCase();
  return `https://placehold.co/${width}x${height}/${hex(bg)}/${hex(fg)}/png?text=${encodeURIComponent(title).replace(/%20/g, '+')}`;
}

export interface SeedImage {
  url: string;
  publicId: string;
}

export interface CloudinaryKeys {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

export const ASSET_DIR = join(process.cwd(), 'seed', 'assets', 'shopping');

/** Resolves (and, with keys, uploads) every seed image. */
export class SeedImages {
  uploaded = 0;
  photos = 0;

  constructor(
    private readonly keys: CloudinaryKeys | null,
    private readonly env: string,
  ) {
    if (keys) {
      cloudinary.config({
        cloud_name: keys.cloudName,
        api_key: keys.apiKey,
        api_secret: keys.apiSecret,
        secure: true,
      });
    }
  }

  get mode(): 'cloudinary' | 'placeholder' {
    return this.keys ? 'cloudinary' : 'placeholder';
  }

  /**
   * One image for `name` (a product slug, "logo" or "cover"), owned by
   * `ownerUserId` under `purpose`. Stable public ids make reruns overwrite
   * rather than duplicate.
   */
  async image(opts: {
    ownerUserId: string;
    purpose:
      | 'product_image'
      | 'store_branding'
      | 'banner'
      | 'doctor_photo'
      | 'food_branding';
    storeKey: string;
    name: string;
    title: string;
    caption?: string;
    bg: string;
    fg: string;
    motif: Motif;
    width?: number;
    height?: number;
    /** A ready-made SVG instead of the generated tile (e.g. an initials avatar). */
    svg?: string;
  }): Promise<SeedImage> {
    const w = opts.width ?? 800;
    const h = opts.height ?? 800;
    const folder = uploadFolder(this.env, opts.ownerUserId, opts.purpose);
    const id = `seed-${opts.storeKey}-${opts.name}`;
    if (!this.keys) {
      return {
        url: placeholdUrl(opts.title, opts.bg, opts.fg, w, h),
        publicId: `${folder}/${id}-${createHash('sha1').update(opts.title).digest('hex').slice(0, 8)}`,
      };
    }
    const photo = ['jpg', 'jpeg', 'png', 'webp']
      .map((ext) => join(ASSET_DIR, opts.storeKey, `${opts.name}.${ext}`))
      .find((f) => existsSync(f));
    const source =
      photo ??
      `data:image/svg+xml;base64,${Buffer.from(opts.svg ?? tileSvg({ ...opts, width: w, height: h })).toString('base64')}`;
    const res = await cloudinary.uploader.upload(source, {
      folder,
      public_id: id,
      overwrite: true,
      resource_type: 'image',
    });
    this.uploaded += 1;
    if (photo) this.photos += 1;
    // SVG tiles are delivered as PNG (f_png): every client can show a PNG.
    const url = photo
      ? res.secure_url
      : cloudinary.url(res.public_id, {
          secure: true,
          format: 'png',
          version: res.version,
        });
    return { url, publicId: res.public_id };
  }

  /**
   * A licensed photo fetched from `url` (the demo doctors' portraits, the
   * Health home's banners): uploaded under `ownerUserId`/`purpose` when
   * Cloudinary is configured, so the API serves its own copy; otherwise the
   * remote URL itself, for development.
   */
  async remote(opts: {
    ownerUserId: string;
    purpose: 'banner' | 'doctor_photo' | 'food_branding' | 'menu_item';
    storeKey: string;
    name: string;
    url: string;
  }): Promise<SeedImage> {
    const folder = uploadFolder(this.env, opts.ownerUserId, opts.purpose);
    const id = `seed-${opts.storeKey}-${opts.name}`;
    if (!this.keys) return { url: opts.url, publicId: `${folder}/${id}` };
    const res = await cloudinary.uploader.upload(opts.url, {
      folder,
      public_id: id,
      overwrite: true,
      resource_type: 'image',
    });
    this.uploaded += 1;
    this.photos += 1;
    return { url: res.secure_url, publicId: res.public_id };
  }
}
