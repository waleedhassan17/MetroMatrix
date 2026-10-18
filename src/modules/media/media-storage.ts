import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { assetParts } from './asset-url';
import { MediaService } from './media.service';

export interface FetchedAsset {
  bytes: Buffer;
  mimeType: string;
}

/**
 * Server-side reads and deletes of uploaded assets (voice clips the API
 * transcribes, then removes after 24 h). Its own provider so tests replace
 * it — the e2e suite never talks to Cloudinary.
 */
export abstract class MediaStorage {
  /**
   * The bytes of an upload (a private one through a signed, short-lived
   * link); 'too_large' past `maxBytes`, null when it can't be read.
   */
  abstract fetch(
    url: string,
    maxBytes: number,
  ): Promise<FetchedAsset | 'too_large' | null>;
  /** Remove an upload; true when Cloudinary confirms (or it is already gone). */
  abstract destroy(url: string): Promise<boolean>;
}

const MIME: Record<string, string> = {
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  pdf: 'application/pdf',
};

export const mimeOf = (url: string): string => {
  const ext = (
    assetParts(url)?.format ||
    url.split('.').pop() ||
    ''
  ).toLowerCase();
  return MIME[ext] ?? 'application/octet-stream';
};

@Injectable()
export class CloudinaryMediaStorage extends MediaStorage {
  private readonly logger = new Logger('MediaStorage');
  private readonly keys: {
    cloudName: string;
    apiKey: string;
    apiSecret: string;
  };

  constructor(
    config: ConfigService,
    private readonly media: MediaService,
  ) {
    super();
    const c = config.get<{
      cloudName: string;
      apiKey: string;
      apiSecret: string;
    }>('integrations.cloudinary');
    this.keys = {
      cloudName: c?.cloudName ?? '',
      apiKey: c?.apiKey ?? '',
      apiSecret: c?.apiSecret ?? '',
    };
  }

  async fetch(
    url: string,
    maxBytes: number,
  ): Promise<FetchedAsset | 'too_large' | null> {
    const signed = url.includes('/authenticated/')
      ? this.media.privateDownload(url)?.downloadUrl
      : url;
    if (!signed) return null;
    try {
      const res = await fetch(signed, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        this.logger.warn(`fetch: HTTP ${res.status}`);
        return null;
      }
      if (Number(res.headers.get('content-length') ?? 0) > maxBytes)
        return 'too_large';
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > maxBytes) return 'too_large';
      return { bytes: buf, mimeType: mimeOf(url) };
    } catch (err) {
      this.logger.warn(`fetch: ${(err as Error).name}`);
      return null;
    }
  }

  async destroy(url: string): Promise<boolean> {
    const parts = assetParts(url);
    if (!parts || !this.keys.apiSecret) return false;
    try {
      const res = (await cloudinary.uploader.destroy(parts.publicId, {
        resource_type: parts.resourceType,
        type: url.includes('/authenticated/') ? 'authenticated' : 'upload',
        invalidate: true,
        cloud_name: this.keys.cloudName,
        api_key: this.keys.apiKey,
        api_secret: this.keys.apiSecret,
      } as unknown as Parameters<typeof cloudinary.uploader.destroy>[1])) as {
        result?: string;
      };
      return res.result === 'ok' || res.result === 'not found';
    } catch (err) {
      this.logger.warn(`destroy: ${(err as Error).message}`);
      return false;
    }
  }
}
