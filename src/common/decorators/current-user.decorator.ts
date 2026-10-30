import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { UserRole } from '../../types';

export interface AuthenticatedUser {
  id: string;
  email: string;
  /** Read from the users row on every request, never trusted from the token. */
  role: UserRole;
  /**
   * The refresh-token family this access token was issued in — one per
   * signed-in device. Sign-out revokes this family only, so signing out on
   * the phone leaves the tablet signed in.
   */
  sid: string;
  /**
   * False until the address is confirmed by the emailed link. Signup hands
   * out a session straight away so the client can sit on its verify screen;
   * EmailVerifiedGuard keeps that session out of everything that needs a
   * proven address. Optional so a user built elsewhere (tests) is treated as
   * verified rather than locked out.
   */
  emailVerified?: boolean;
  /** Admins only, from the users row: a regular admin's grants. */
  adminPermissions?: string[];
  /** Admins only: the session may only change the password until cleared. */
  mustChangePassword?: boolean;
  /** Admins only: false until an authenticator is enrolled. */
  totpEnabled?: boolean;
}

export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const user = req.user;
    if (!user) return undefined;
    return data ? user[data] : user;
  },
);
