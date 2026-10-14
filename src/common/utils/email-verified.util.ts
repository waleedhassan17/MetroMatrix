import { ForbiddenException } from '@nestjs/common';
import { AuthenticatedUser } from '../decorators/current-user.decorator';
import { ErrorCode } from '../errors/codes';

export const EMAIL_NOT_VERIFIED_MESSAGE =
  'Please verify your email address first. Enter the 6-digit code we emailed you.';

/**
 * Refuses a session whose owner has not confirmed their email address.
 *
 * Signup hands every new account a session at once, so the app can sit on its
 * verify screen. That session must not reach anything that needs a proven
 * address — a partner cannot open a business under an inbox nobody owns.
 *
 * Only an explicit `false` refuses — see AuthenticatedUser.emailVerified.
 */
export function assertEmailVerified(
  user: Pick<AuthenticatedUser, 'emailVerified'> | null | undefined,
): void {
  if (user?.emailVerified === false) {
    throw new ForbiddenException({
      code: ErrorCode.EMAIL_NOT_VERIFIED,
      message: EMAIL_NOT_VERIFIED_MESSAGE,
    });
  }
}
