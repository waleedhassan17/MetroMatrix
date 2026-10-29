import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { STEP_UP_KEY } from '../../../common/decorators/require-step-up.decorator';
import { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import { ErrorCode } from '../../../common/errors/codes';
import { UsersService } from '../../users/users.service';
import { TotpService } from '../totp.service';

/**
 * Global, last. On @RequireStepUp routes the actor proves, again, that they
 * hold their authenticator: `totpCode` in the body, checked against their
 * own secret, and spent — a code (or an older one) never works twice.
 *
 * 403 rather than 401 on a bad code: the session itself is fine, and a 401
 * would send the console off to refresh its token.
 */
@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly users: UsersService,
    private readonly totp: TotpService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      !this.reflector.getAllAndOverride<boolean>(STEP_UP_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const raw = (req.body as { totpCode?: unknown } | undefined)?.totpCode;
    const code = typeof raw === 'string' ? raw.replace(/\s/g, '') : '';
    if (!code) {
      throw new ForbiddenException({
        code: ErrorCode.STEP_UP_REQUIRED,
        message: 'Enter a code from your authenticator app to confirm.',
      });
    }
    const user = req.user ? await this.users.findById(req.user.id) : null;
    if (
      !user ||
      !/^\d{6}$/.test(code) ||
      !(await this.totp.spendCode(user, code))
    ) {
      throw new ForbiddenException({
        code: ErrorCode.TOTP_INVALID,
        message:
          'That code is not right, or it was already used. Wait for the next one and try again.',
      });
    }
    return true;
  }
}
