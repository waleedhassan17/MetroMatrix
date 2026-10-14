import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { ErrorCode } from '../../common/errors/codes';

/** What we take from a verified Google ID token. */
export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

/**
 * Verifies a Google ID token's signature, expiry, issuer and audience — the
 * audience must be one of our own client ids (web, Android, iOS), so a token
 * minted for some other app is refused.
 *
 * Kept as its own provider so tests can swap it for a fake.
 */
@Injectable()
export class GoogleTokenVerifier {
  private readonly logger = new Logger(GoogleTokenVerifier.name);
  private readonly client = new OAuth2Client();
  private readonly audience: string[];

  constructor(config: ConfigService) {
    this.audience = config.get<string[]>('integrations.googleClientIds', []);
  }

  async verify(idToken: string): Promise<GoogleIdentity> {
    if (this.audience.length === 0) {
      throw new ServiceUnavailableException({
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: 'Google sign-in is not configured on this server.',
      });
    }
    let payload;
    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.audience,
      });
      payload = ticket.getPayload();
    } catch (err) {
      this.logger.warn(`Google ID token refused: ${(err as Error).message}`);
    }
    if (!payload?.sub || !payload.email) {
      throw new UnauthorizedException({
        code: ErrorCode.INVALID_CREDENTIALS,
        message: 'Google sign-in failed. Please try again.',
      });
    }
    return {
      sub: payload.sub,
      email: payload.email.trim().toLowerCase(),
      emailVerified: payload.email_verified === true,
      name: payload.name?.trim() || null,
      picture: payload.picture ?? null,
    };
  }
}
