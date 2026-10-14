import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { ErrorCode } from '../../common/errors/codes';
import {
  ownedAssetProblem,
  UPLOAD_PURPOSES,
  UploadPurpose,
  uploadFolder,
} from './asset-url';

export interface SignedUpload {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  folder: string;
  publicIdPrefix: string;
  /** POST the file here with exactly these signed params + `file` + `api_key`. */
  uploadUrl: string;
  /** Signed too: send it as `allowed_formats`. */
  allowedFormats: string;
  maxBytes: number;
}

/**
 * Cloudinary direct uploads. The API signs; the phone uploads; the API then
 * only accepts URLs that land inside the folder it signed for.
 */
@Injectable()
export class MediaService {
  private readonly cloudName: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly env: string;

  constructor(config: ConfigService) {
    const c = config.get<{
      cloudName: string;
      apiKey: string;
      apiSecret: string;
    }>('integrations.cloudinary');
    this.cloudName = c?.cloudName ?? '';
    this.apiKey = c?.apiKey ?? '';
    this.apiSecret = c?.apiSecret ?? '';
    this.env = config.get<string>('app.nodeEnv', 'development');
  }

  folderFor(userId: string, purpose: UploadPurpose): string {
    return uploadFolder(this.env, userId, purpose);
  }

  /**
   * Everything but `file` and `api_key` is signed, so the client cannot change
   * the folder or the allowed formats.
   */
  signUpload(userId: string, purpose: UploadPurpose): SignedUpload {
    if (!this.cloudName || !this.apiKey || !this.apiSecret) {
      throw new ServiceUnavailableException({
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: 'File uploads are not configured on this server.',
      });
    }
    const spec = UPLOAD_PURPOSES[purpose];
    const timestamp = Math.round(Date.now() / 1000);
    const folder = this.folderFor(userId, purpose);
    const allowedFormats = spec.formats.join(',');
    const signature = cloudinary.utils.api_sign_request(
      { allowed_formats: allowedFormats, folder, timestamp },
      this.apiSecret,
    );
    return {
      cloudName: this.cloudName,
      apiKey: this.apiKey,
      timestamp,
      signature,
      folder,
      publicIdPrefix: `${folder}/`,
      uploadUrl: `https://api.cloudinary.com/v1_1/${this.cloudName}/${spec.resourceType}/upload`,
      allowedFormats,
      maxBytes: spec.maxBytes,
    };
  }

  /** 400 VALIDATION_FAILED unless `url` is this user's upload for `purpose`. */
  assertOwnedAsset(
    userId: string,
    purpose: UploadPurpose,
    url: string,
    publicId?: string,
    field = 'url',
  ): void {
    const problem = ownedAssetProblem({
      url,
      publicId,
      cloudName: this.cloudName,
      folder: this.folderFor(userId, purpose),
    });
    if (problem) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: problem,
        details: { fields: { [field]: [problem] } },
      });
    }
  }
}
