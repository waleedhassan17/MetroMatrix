import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';
import { DataSource, Not } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { PasswordHasher } from '../password-hasher';
import { TokenService } from '../token.service';
import { TotpChallengeResult } from '../auth-result';
import { OperationalAuditService } from '../../../common/audit/operational-audit.service';
import { ErrorCode } from '../../../common/errors/codes';
import { AdminSetupDto, AdminSetupStatusView } from './admin-setup.dto';

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();

/** Constant-time: how much of a wrong code matched never shows in the timing. */
export function setupCodeMatches(given: string, expected: string): boolean {
  return !!expected && timingSafeEqual(digest(given), digest(expected));
}

/**
 * First run: registering the first super admin from the web console.
 *
 * Open only while no super admin exists, and only with ADMIN_SETUP_CODE — set
 * on the server before the first visit, so nobody who merely finds a fresh
 * deployment can claim it. After that the console only signs in;
 * `npm run seed:superadmin` stays the operator's way back in.
 *
 * The new account then enrols its authenticator exactly like a seeded one:
 * the answer is the admin portal's step 1 (`enrolmentRequired: true`).
 */
@Injectable()
export class AdminSetupService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
    private readonly audit: OperationalAuditService,
    private readonly config: ConfigService,
  ) {}

  private get code(): string {
    return this.config.get<string>('adminWeb.setupCode', '') ?? '';
  }

  async status(): Promise<AdminSetupStatusView> {
    return {
      setupRequired: !(await this.superAdminExists()),
      setupCodeConfigured: !!this.code,
    };
  }

  async setup(dto: AdminSetupDto): Promise<TotpChallengeResult> {
    if (!this.code) {
      throw new ForbiddenException({
        code: ErrorCode.SETUP_DISABLED,
        message:
          'Registration is off. Set ADMIN_SETUP_CODE on the server first.',
      });
    }
    if (!setupCodeMatches(dto.setupCode, this.code)) {
      throw new ForbiddenException({
        code: ErrorCode.SETUP_CODE_INVALID,
        message: 'That setup code is not right.',
        details: { fields: { setupCode: ['does not match the server'] } },
      });
    }
    const email = dto.email.trim().toLowerCase();
    const passwordHash = await this.hasher.hash(dto.password);

    const user = await this.dataSource.transaction(async (m) => {
      // Two registrations at once: the lock makes the second see the first.
      await m.query(`SELECT pg_advisory_xact_lock(hashtext('admin_setup'))`);
      const repo = m.getRepository(User);
      if (
        await repo.exists({
          where: { role: 'super_admin', status: Not('deleted') },
        })
      ) {
        throw new ConflictException({
          code: ErrorCode.SETUP_COMPLETE,
          message: 'This console is already set up. Sign in instead.',
        });
      }
      // users.email is unique across every row, deleted ones included.
      if (await repo.exists({ where: { email } })) {
        throw new ConflictException({
          code: ErrorCode.EMAIL_EXISTS,
          message: 'An account with this email already exists.',
          details: { fields: { email: ['already used by another account'] } },
        });
      }
      return repo.save(
        repo.create({
          email,
          displayName: dto.displayName,
          passwordHash,
          role: 'super_admin',
          isEmailVerified: true,
          status: 'active',
          totpEnabled: false,
          mustChangePassword: false,
        }),
      );
    });

    await this.audit.record({
      actorUserId: user.id,
      action: 'admin.setup',
      targetType: 'user',
      targetId: user.id,
      before: null,
      after: { email, displayName: dto.displayName, role: 'super_admin' },
    });
    return {
      totpRequired: true,
      enrolmentRequired: true,
      challengeToken: await this.tokens.signChallenge(user),
    };
  }

  private superAdminExists(): Promise<boolean> {
    return this.dataSource
      .getRepository(User)
      .exists({ where: { role: 'super_admin', status: Not('deleted') } });
  }
}
