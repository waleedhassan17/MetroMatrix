import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { EmailVerificationToken } from './entities/email-verification-token.entity';
import { MailService } from '../mail/mail.service';
import { OperationalAuditService } from '../../common/audit/operational-audit.service';
import { ErrorCode } from '../../common/errors/codes';
import { randomToken, sha256Hex } from '../../common/crypto/hash';

export interface VerifyOutcome {
  user: User;
  /** The link had already been spent (or the address was verified another way). */
  alreadyVerified: boolean;
}

/**
 * Email ownership by link (FinMatrix's flow). Signup and resend email a link
 * carrying a 32-byte random token; only its SHA-256 is stored. The link works
 * for EMAIL_VERIFY_TTL_HOURS, a new one retires the old, and resends are 60 s
 * apart.
 *
 * A spent or expired link whose owner IS verified succeeds: mail scanners open
 * links before people do, people tap twice, and a resend retires the link in
 * the older email. Only a link that still has work to do can fail.
 */
@Injectable()
export class EmailVerificationService {
  private readonly ttlMs: number;
  private readonly cooldownMs: number;

  constructor(
    @InjectRepository(EmailVerificationToken)
    private readonly repo: Repository<EmailVerificationToken>,
    private readonly users: UsersService,
    private readonly mail: MailService,
    private readonly audit: OperationalAuditService,
    private readonly dataSource: DataSource,
    config: ConfigService,
  ) {
    this.ttlMs = config.get<number>('mail.verifyTtlHours', 24) * 3_600_000;
    this.cooldownMs =
      config.get<number>('mail.resendCooldownSeconds', 60) * 1000;
  }

  /** Retire any outstanding link, store a new one, email it. */
  async issue(user: User): Promise<void> {
    await this.repo.update(
      { userId: user.id, usedAt: IsNull() },
      { usedAt: new Date() },
    );
    const token = randomToken(32);
    await this.repo.insert(
      this.repo.create({
        userId: user.id,
        tokenHash: sha256Hex(token),
        expiresAt: new Date(Date.now() + this.ttlMs),
        usedAt: null,
      }),
    );
    // MailService never throws: a mail failure leaves the link resendable.
    await this.mail.sendVerificationLink(user.email, user.displayName, token);
  }

  async resend(
    user: User,
  ): Promise<{ sent: boolean; alreadyVerified: boolean; retryAfter: number }> {
    if (user.isEmailVerified) {
      return { sent: false, alreadyVerified: true, retryAfter: 0 };
    }
    const latest = await this.repo.findOne({
      where: { userId: user.id },
      order: { createdAt: 'DESC' },
    });
    const elapsed = latest ? Date.now() - latest.createdAt.getTime() : Infinity;
    if (elapsed < this.cooldownMs) {
      const retryAfter = Math.ceil((this.cooldownMs - elapsed) / 1000);
      throw new HttpException(
        {
          code: ErrorCode.RESEND_COOLDOWN,
          message: `Please wait ${retryAfter} seconds before requesting another email.`,
          details: { retryAfter },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    await this.issue(user);
    return {
      sent: true,
      alreadyVerified: false,
      retryAfter: Math.ceil(this.cooldownMs / 1000),
    };
  }

  /** Spend a link's token. */
  async verify(token: string): Promise<VerifyOutcome> {
    const record = token
      ? await this.repo.findOne({ where: { tokenHash: sha256Hex(token) } })
      : null;
    if (!record) throw this.invalid();
    const owner = await this.users.findById(record.userId);
    if (!owner) throw this.invalid();

    const spent =
      record.usedAt !== null || record.expiresAt.getTime() <= Date.now();
    if (spent || owner.isEmailVerified) {
      if (owner.isEmailVerified) return { user: owner, alreadyVerified: true };
      throw this.invalid();
    }

    // Spend the token and verify the address together. The conditional
    // update settles a race between two opens of the same link: only one
    // of them spends it, the other finds the owner verified.
    const won = await this.dataSource.transaction(async (m) => {
      const res = await m
        .createQueryBuilder()
        .update(EmailVerificationToken)
        .set({ usedAt: () => 'now()' })
        .where('id = :id AND used_at IS NULL', { id: record.id })
        .execute();
      if (!res.affected) return false;
      await m.update(User, { id: owner.id }, { isEmailVerified: true });
      return true;
    });
    const user = (await this.users.findById(owner.id)) ?? owner;
    if (!won) {
      if (user.isEmailVerified) return { user, alreadyVerified: true };
      throw this.invalid();
    }
    await this.audit.record({
      actorUserId: user.id,
      action: 'auth.email_verified',
      targetType: 'user',
      targetId: user.id,
      details: { method: 'link' },
    });
    return { user, alreadyVerified: false };
  }

  /** Where the API's own page sends people onward. Never the token: it is spent. */
  onwardLinks(): { app: string } {
    return { app: `${this.mail.appScheme()}://verify-email?verified=1` };
  }

  private invalid() {
    return new BadRequestException({
      code: ErrorCode.VERIFY_LINK_INVALID,
      message:
        'This link has expired or been replaced. Open the app and tap Resend.',
    });
  }
}
