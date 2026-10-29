import { Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { TotpService } from '../auth/totp.service';
import { OperationalAuditService } from '../../common/audit/operational-audit.service';
import { settingsSchema } from '../platform/settings-schema';
import { BROADCAST_AUDIENCE_INFO } from '../broadcasts/broadcast-audience';

/** GET /admin/meta's lists, and the admin's own recovery codes. */
@Injectable()
export class AdminMetaService {
  constructor(
    private readonly users: UsersService,
    private readonly totp: TotpService,
    private readonly audit: OperationalAuditService,
  ) {}

  /** Plain data from the modules that own it; no DI, so no import cycle. */
  broadcastAudiences(): Array<Record<string, unknown>> {
    return BROADCAST_AUDIENCE_INFO;
  }

  settingsSchema(): Array<Record<string, unknown>> {
    return settingsSchema();
  }

  async regenerateRecoveryCodes(userId: string) {
    const user = await this.users.getByIdOrFail(userId);
    const unused = await this.totp.remainingRecoveryCodes(user.id);
    const result = await this.totp.regenerateRecoveryCodes(user);
    // Counts only: the codes themselves never reach the audit trail.
    await this.audit.record({
      actorUserId: user.id,
      action: 'admin.recovery_codes_regenerated',
      targetType: 'user',
      targetId: user.id,
      before: { unusedRecoveryCodes: unused },
      after: { unusedRecoveryCodes: result.recoveryCodes.length },
    });
    return result;
  }
}
