/**
 * Uploaded-file URLs the API will accept from a client.
 *
 * Files go from the phone straight to Cloudinary with a short-lived signature
 * (POST /media/sign-upload) — the API is not a file proxy. The client then
 * hands the API the URL. That URL is untrusted input: it must be https, on
 * OUR Cloudinary cloud, and inside the folder the signature was issued for —
 * this purpose, this user. Anything else (a `file://` path from the phone,
 * someone else's upload, an arbitrary site) is refused.
 *
 * Ported from the FYP backend's utils/assetUrl.js.
 */

export const UPLOAD_PURPOSES = {
  avatar: {
    resourceType: 'image',
    formats: ['jpg', 'jpeg', 'png', 'webp', 'heic'],
    maxBytes: 5_000_000,
  },
  business_document: {
    // `auto` so a PDF licence and a phone photo both upload to one endpoint.
    resourceType: 'auto',
    formats: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'pdf'],
    maxBytes: 10_000_000,
  },
  // ── Shopping ──
  product_image: {
    resourceType: 'image',
    formats: ['jpg', 'jpeg', 'png', 'webp', 'heic'],
    maxBytes: 8_000_000,
  },
  /** Store logo and cover. */
  store_branding: {
    resourceType: 'image',
    formats: ['jpg', 'jpeg', 'png', 'webp', 'heic'],
    maxBytes: 5_000_000,
  },
  review_photo: {
    resourceType: 'image',
    formats: ['jpg', 'jpeg', 'png', 'webp', 'heic'],
    maxBytes: 8_000_000,
  },
  return_photo: {
    resourceType: 'image',
    formats: ['jpg', 'jpeg', 'png', 'webp', 'heic'],
    maxBytes: 10_000_000,
  },
  /** A transfer screenshot or a PDF receipt. */
  payment_proof: {
    resourceType: 'auto',
    formats: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'pdf'],
    maxBytes: 10_000_000,
  },
  /** Admin home-screen banners. */
  banner: {
    resourceType: 'image',
    formats: ['jpg', 'jpeg', 'png', 'webp'],
    maxBytes: 8_000_000,
  },
  // ── Healthcare ──
  /** The doctor's profile photo. */
  doctor_photo: {
    resourceType: 'image',
    formats: ['jpg', 'jpeg', 'png', 'webp', 'heic'],
    maxBytes: 5_000_000,
  },
  /** A patient's lab report, scan or old prescription (photo or PDF). PHI: private. */
  health_record: {
    resourceType: 'auto',
    formats: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'pdf'],
    maxBytes: 15_000_000,
    delivery: 'authenticated',
  },
  /** Files on a doctor's private visit notes. PHI: private. */
  medical_note: {
    resourceType: 'auto',
    formats: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'pdf'],
    maxBytes: 15_000_000,
    delivery: 'authenticated',
  },
} as const;

/**
 * `authenticated` uploads are not on the public CDN: only a URL carrying
 * Cloudinary's signature serves them, and the API hands other people only
 * short-lived download links (MediaService.privateDownload).
 */
export type Delivery = 'upload' | 'authenticated';
export const deliveryOf = (purpose: UploadPurpose): Delivery =>
  (UPLOAD_PURPOSES[purpose] as { delivery?: Delivery }).delivery ?? 'upload';

export type UploadPurpose = keyof typeof UPLOAD_PURPOSES;
export const UPLOAD_PURPOSE_NAMES = Object.keys(
  UPLOAD_PURPOSES,
) as UploadPurpose[];

/** metromatrix/{env}/{userId}/{purpose} */
export function uploadFolder(
  env: string,
  userId: string,
  purpose: UploadPurpose,
): string {
  return `metromatrix/${env}/${userId}/${purpose}`;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Null when `url` is an upload into `folder` on `cloudName`, else the reason
 * it is not. When `publicId` is given it must be the URL's own public id.
 */
export function ownedAssetProblem(opts: {
  url: string;
  publicId?: string;
  cloudName: string;
  folder: string;
  delivery?: Delivery;
}): string | null {
  const value = opts.url.trim();
  if (/^(file|content|ph|assets-library):/i.test(value)) {
    return 'That file was never uploaded — upload it first, then save.';
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return 'That is not a valid file URL.';
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'res.cloudinary.com'
  ) {
    return 'Files must be uploaded through the app.';
  }
  if (parsed.search || parsed.hash) return 'That is not a valid file URL.';

  // /<cloud>/<image|raw|video>/upload/[v123/]<folder>/<file>
  // /<cloud>/<image|raw|video>/authenticated/[s--sig--/][v123/]<folder>/<file>
  const delivery =
    (opts.delivery ?? 'upload') === 'authenticated'
      ? 'authenticated/(?:s--[A-Za-z0-9_-]{8,32}--/)?'
      : 'upload/';
  const re = new RegExp(
    `^/${escapeRe(opts.cloudName)}/(?:image|raw|video)/${delivery}(?:v\\d+/)?(${escapeRe(opts.folder)}/[^/]+)$`,
  );
  const match = re.exec(parsed.pathname);
  if (!opts.cloudName || !match) return "That file isn't one of your uploads.";

  if (opts.publicId !== undefined) {
    const assetPath = decodeURIComponent(match[1]);
    const id = opts.publicId.trim();
    const sameAsset =
      id.startsWith(`${opts.folder}/`) &&
      !id.slice(opts.folder.length + 1).includes('/') &&
      (assetPath === id || assetPath.startsWith(`${id}.`));
    if (!sameAsset) return "That file's public id does not match its URL.";
  }
  return null;
}

/** The pieces of a Cloudinary delivery URL needed to sign a private download. */
export function assetParts(
  url: string,
): { resourceType: string; publicId: string; format: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const m =
    /^\/[^/]+\/(image|raw|video)\/(?:upload|authenticated)\/(?:s--[A-Za-z0-9_-]{8,32}--\/)?(?:v\d+\/)?(.+)$/.exec(
      parsed.pathname,
    );
  if (!m) return null;
  const [, resourceType, path] = m;
  const file = decodeURIComponent(path);
  // Raw assets keep their extension in the public id; images and videos don't.
  if (resourceType === 'raw')
    return { resourceType, publicId: file, format: '' };
  const dot = file.lastIndexOf('.');
  return dot > file.lastIndexOf('/')
    ? {
        resourceType,
        publicId: file.slice(0, dot),
        format: file.slice(dot + 1),
      }
    : { resourceType, publicId: file, format: '' };
}
