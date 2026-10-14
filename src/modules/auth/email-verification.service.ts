import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { EmailVerificationOtp } from './entities/email-verification-otp.entity';
import { MailService } from '../mail/mail.service';
import { OperationalAuditService } from '../../common/audit/operational-audit.service';
import { ErrorCode } from '../../common/errors/codes';
import { generateOtp, hashCode, verifyCode } from '../../common/crypto/otp';

const PURPOSE = 'email-verify';

/**
 * Email ownership by 6-digit code: issued on signup and on resend, 10 minutes,
 * 5 attempts, 60 s between sends. The code never touches the database in the
 * clear.
 */
@Injectable()
export class EmailVerificationService {
  private readonly pepper: string;
  private readonly ttlMs: number;
  private readonly maxAttempts: number;
  private readonly cooldownMs: number;

  constructor(
    @InjectRepository(EmailVerificationOtp)
    private readonly repo: Repository<EmailVerificationOtp>,
    private readonly users: UsersService,
    private readonly mail: MailService,
    private readonly audit: OperationalAuditService,
    config: ConfigService,
  ) {
    this.pepper = config.getOrThrow<string>('auth.otpPepper');
    this.ttlMs = config.get<number>('mail.otpTtlMinutes', 10) * 60_000;
    this.maxAttempts = config.get<number>('mail.otpMaxAttempts', 5);
    this.cooldownMs =
      config.get<number>('mail.resendCooldownSeconds', 60) * 1000;
  }

  /** Retire any outstanding code, store a new one, email it. */
  async issue(user: User): Promise<void> {
    await this.repo.update(
      { userId: user.id, usedAt: IsNull() },
      { usedAt: new Date() },
    );
    const otp = generateOtp();
    await this.repo.insert(
      this.repo.create({
        userId: user.id,
        otpHash: hashCode(this.pepper, PURPOSE, user.id, otp),
        attempts: 0,
        expiresAt: new Date(Date.now() + this.ttlMs),
        usedAt: null,
      }),
    );
    await this.mail.sendVerificationOtp(user.email, user.displayName, otp);
  }

  async resend(
    user: User,
  ): Promise<{ sent: boolean; alreadyVerified: boolean; retryAfter: number }> {
    const cooldown = Math.ceil(this.cooldownMs / 1000);
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
          message: `Please wait ${retryAfter} seconds before requesting another code.`,
          details: { retryAfter },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    await this.issue(user);
    return { sent: true, alreadyVerified: false, retryAfter: cooldown };
  }

  /**
   * Check a code against the most recent one sent.
   *
   * - expired → OTP_EXPIRED
   * - wrong → OTP_INVALID with `attemptsLeft`; the 5th wrong try locks the
   *   code (OTP_LOCKED) and only a resend issues a new one
   * - right → the address is verified
   */
  async verify(user: User, otp: string): Promise<User> {
    if (user.isEmailVerified) return user;

    const latest = await this.repo.findOne({
      where: { userId: user.id },
      order: { createdAt: 'DESC' },
    });
    if (!latest) {
      throw new BadRequestException({
        code: ErrorCode.OTP_INVALID,
        message: 'No code has been sent. Request a new one.',
      });
    }
    if (latest.attempts >= this.maxAttempts) throw this.locked();
    if (latest.usedAt) {
      throw new BadRequestException({
        code: ErrorCode.OTP_INVALID,
        message: 'This code is no longer valid. Request a new one.',
      });
    }
    if (latest.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException({
        code: ErrorCode.OTP_EXPIRED,
        message: 'This code has expired. Request a new one.',
      });
    }

    if (!verifyCode(this.pepper, PURPOSE, user.id, otp, latest.otpHash)) {
      // Atomic increment: two wrong guesses at once still count twice.
      const res = await this.repo
        .createQueryBuilder()
        .update()
        .set({ attempts: () => 'attempts + 1' })
        .where('id = :id', { id: latest.id })
        .returning('attempts')
        .execute();
      const attempts = Number(
        (res.raw as { attempts: number }[])[0]?.attempts ?? this.maxAttempts,
      );
      if (attempts >= this.maxAttempts) {
        await this.repo.update({ id: latest.id }, { usedAt: new Date() });
        throw this.locked();
      }
      throw new BadRequestException({
        code: ErrorCode.OTP_INVALID,
        message: 'That code is not right. Check the email and try again.',
        details: { attemptsLeft: this.maxAttempts - attempts },
      });
    }

    await this.repo.update({ id: latest.id }, { usedAt: new Date() });
    user.isEmailVerified = true;
    const saved = await this.users.save(user);
    await this.audit.record({
      actorUserId: user.id,
      action: 'auth.email_verified',
      targetType: 'user',
      targetId: user.id,
    });
    return saved;
  }

  private locked() {
    return new BadRequestException({
      code: ErrorCode.OTP_LOCKED,
      message: 'Too many incorrect attempts. Request a new code.',
    });
  }
}
