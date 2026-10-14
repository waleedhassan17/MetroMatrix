import { UnauthorizedException } from '@nestjs/common';
import {
  GoogleIdentity,
  GoogleTokenVerifier,
} from '../../src/modules/auth/google-token-verifier';

/**
 * Stands in for Google in e2e: an "ID token" is `fake-google:` + the JSON of
 * the identity it should verify to. Anything else is refused like a forged
 * token.
 */
export class FakeGoogleVerifier implements Pick<GoogleTokenVerifier, 'verify'> {
  async verify(idToken: string): Promise<GoogleIdentity> {
    if (!idToken.startsWith('fake-google:')) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Google sign-in failed. Please try again.',
      });
    }
    return JSON.parse(idToken.slice('fake-google:'.length)) as GoogleIdentity;
  }
}

export const googleToken = (
  identity: Partial<GoogleIdentity> & { sub: string; email: string },
) =>
  'fake-google:' +
  JSON.stringify({
    emailVerified: true,
    name: 'Google User',
    picture: null,
    ...identity,
  });
