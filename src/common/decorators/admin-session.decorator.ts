import { SetMetadata } from '@nestjs/common';

export const ALLOW_RESTRICTED_ADMIN_KEY = 'allowRestrictedAdmin';

/**
 * One of the few routes an admin session may call while it must change its
 * password or enrol an authenticator: /auth/me, change-password, sign-out.
 * Everything else answers 403 PASSWORD_CHANGE_REQUIRED / TOTP_REQUIRED
 * (AdminSessionGuard).
 */
export const AllowRestrictedAdmin = () =>
  SetMetadata(ALLOW_RESTRICTED_ADMIN_KEY, true);
