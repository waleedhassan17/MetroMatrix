import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedUser } from '../decorators/current-user.decorator';
import { assertEmailVerified } from '../utils/email-verified.util';

/**
 * Refuses an unverified account's session (see assertEmailVerified).
 *
 * Put it on routes that need a proven address — partner onboarding above all.
 * Must run after JwtAuthGuard, which is what puts `emailVerified` on the
 * request.
 */
@Injectable()
export class EmailVerifiedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    assertEmailVerified(req.user);
    return true;
  }
}
