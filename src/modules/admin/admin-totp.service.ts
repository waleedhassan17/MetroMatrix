import { BadRequestException, Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { TotpService } from '../auth/totp.service';
import { AuthService } from '../auth/auth.service';
import { TokenService } from '../auth/token.service';
import { AuthResult } from '../auth/auth-result';
import { TotpAuth } from '../auth/guards/admin-totp-enrol.guard';
import { ConfirmTotpDto } from '../auth/dto/totp.dto';
import { OperationalAuditService } from '../../common/audit/operational-audit.service';
import { ClientInfo } from '../../common/decorators/client-info.decorator';
import { ErrorCode } from '../../common/errors/codes';
import type { SessionClient } from '../auth/web/admin-web-session';

/** /admin/me/totp — enrolling (or rotating) an admin's authenticator. */
@Injectable()
export class AdminTotpService {
  constructor(
    private readonly users: UsersService,
    private readonly totp: TotpService,
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly audit: OperationalAuditService,
  ) {}

  async enrol(userId: string) {
    return this.totp.enrol(await this.users.getByIdOrFail(userId));
  }

  async confirm(
    userId: string,
    via: TotpAuth,
    dto: ConfirmTotpDto,
    client: ClientInfo,
    kind: SessionClient = 'app',
  ): Promise<{ recoveryCodes: string[]; auth: AuthResult | null }> {
    const user = await this.users.getByIdOrFail(userId);
    const rotation = user.totpEnabled;
    // Replacing a working authenticator needs a code from it: a stolen
    // session alone must not be able to move the second factor.
    if (
      rotation &&
      !(dto.currentCode && (await this.totp.spendCode(user, dto.currentCode)))
    ) {
      throw new BadRequestException({
        code: ErrorCode.TOTP_INVALID,
        message: 'Enter a code from your current authenticator to replace it.',
      });
    }

    const { recoveryCodes } = await this.totp.confirm(user, dto.code);
    await this.audit.record({
      actorUserId: user.id,
      action: rotation ? 'admin.totp_rotated' : 'admin.totp_enrolled',
      targetType: 'user',
      targetId: user.id,
    });

    let auth: AuthResult | null = null;
    if (via.kind === 'challenge') {
      // First enrolment completes the sign-in the challenge started.
      await this.tokens.denylist(via.jti, user.id, via.exp);
      const fresh = await this.users.getByIdOrFail(user.id);
      auth = await this.auth.completeSignin(
        fresh,
        client,
        {
          portal: 'admin',
          method: 'totp_enrol',
          ...(kind === 'admin_web' ? { client: kind } : {}),
        },
        kind,
      );
    }
    return { recoveryCodes, auth };
  }
}
