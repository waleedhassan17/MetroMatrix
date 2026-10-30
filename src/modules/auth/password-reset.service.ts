import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, MoreThan, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { PasswordResetOtp } from './entities/password-reset-otp.entity';
import { MailService } from '../mail/mail.service';
import { TokenService } from './token.service';
import { PasswordHasher } from './password-hasher';
import { OperationalAuditService } from '../../common/audit/operational-audit.service';
import { ErrorCode } from '../../common/errors/codes';
import { generateOtp, hashCode, verifyCode } from '../../common/crypto/otp';
import { randomToken, sha256Hex } from '../../common/crypto/hash';

const PURPOSE = 'password-reset';

/** Reset codes emailed per account per hour, at most. */
export const MAX_CODES_PER_HOUR = 3;

const invalidCode = () =>
  new BadRequestException({
    code: ErrorCode.OTP_INVALID,
    message: 'The code is invalid or has expired.',
  });

/**
 * Forgot password → emailed OTP → single-use reset token → new password.
 * The reset signs the account out everywhere.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  private readonly pepper: string;
  private readonly otpTtlMs: number;
  private readonly maxAttempts: number;
  private readonly resetTtlMs: number;

  constructor(
    @InjectRepository(PasswordResetOtp)
    private readonly repo: Repository<PasswordResetOtp>,
    private readonly users: UsersService,
    private readonly mail: MailService,
    private readonly tokens: TokenService,
    private readonly hasher: PasswordHasher,
    private readonly audit: OperationalAuditService,
    private readonly dataSource: DataSource,
    config: ConfigService,
  ) {
    this.pepper = config.getOrThrow<string>('auth.otpPepper');
    this.otpTtlMs = config.get<number>('mail.otpTtlMinutes', 10) * 60_000;
    this.maxAttempts = config.get<number>('mail.otpMaxAttempts', 5);
    this.resetTtlMs =
      config.get<number>('auth.resetTokenTtlMinutes', 15) * 60_000;
  }

  /**
   * Always the same answer, whether or not the address has an account — the
   * caller learns nothing about who is registered:
   * - an unknown or inactive address still generates and hashes a code, so
   *   both paths do comparable work;
   * - the email is sent without waiting for it (MailService never throws), so
   *   the SMTP round-trip doesn't show in the response time;
   * - at most MAX_CODES_PER_HOUR codes per account per hour: beyond that the
   *   answer is the same and nothing is sent (the Throttler is per IP and
   *   per instance; this protects the inbox from any number of them).
   */
  async forgot(email: string): Promise<{ delivered: true }> {
    const user = await this.users.findByEmail(email);
    const otp = generateOtp();
    if (!user || user.status !== 'active') {
      hashCode(this.pepper, PURPOSE, 'no-account', otp);
      return { delivered: true };
    }

    const recent = await this.repo.count({
      where: {
        userId: user.id,
        createdAt: MoreThan(new Date(Date.now() - 3_600_000)),
      },
    });
    if (recent >= MAX_CODES_PER_HOUR) {
      this.logger.warn(`Reset code cap reached for user ${user.id}`);
      return { delivered: true };
    }

    await this.repo.update(
      { userId: user.id, usedAt: IsNull() },
      { usedAt: new Date() },
    );
    await this.repo.insert(
      this.repo.create({
        userId: user.id,
        otpHash: hashCode(this.pepper, PURPOSE, user.id, otp),
        resetTokenHash: null,
        attempts: 0,
        expiresAt: new Date(Date.now() + this.otpTtlMs),
        verifiedAt: null,
        usedAt: null,
      }),
    );
    void this.mail.sendPasswordResetOtp(user.email, user.displayName, otp);
    return { delivered: true };
  }

  async verifyOtp(email: string, otp: string): Promise<{ resetToken: string }> {
    const user = await this.users.findByEmail(email);
    if (!user || user.status !== 'active') throw invalidCode();

    const latest = await this.repo.findOne({
      where: { userId: user.id },
      order: { createdAt: 'DESC' },
    });
    if (!latest) throw invalidCode();
    if (latest.attempts >= this.maxAttempts) throw this.locked();
    if (latest.usedAt || latest.verifiedAt) throw invalidCode();
    if (latest.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException({
        code: ErrorCode.OTP_EXPIRED,
        message: 'This code has expired. Request a new one.',
      });
    }

    if (!verifyCode(this.pepper, PURPOSE, user.id, otp, latest.otpHash)) {
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
        this.logger.warn(`Reset OTP locked for user ${user.id}`);
        throw this.locked();
      }
      throw new BadRequestException({
        code: ErrorCode.OTP_INVALID,
        message: 'That code is not right. Check the email and try again.',
        details: { attemptsLeft: this.maxAttempts - attempts },
      });
    }

    const resetToken = randomToken(32);
    await this.repo.update(
      { id: latest.id },
      { verifiedAt: new Date(), resetTokenHash: sha256Hex(resetToken) },
    );
    return { resetToken };
  }

  /**
   * Spend the reset token. Revokes every session — refresh tokens and, via
   * the token-version bump, every outstanding access token.
   */
  async reset(
    resetToken: string,
    newPassword: string,
  ): Promise<{ reset: true }> {
    const record = await this.repo.findOne({
      where: { resetTokenHash: sha256Hex(resetToken), usedAt: IsNull() },
    });
    const fresh =
      record?.verifiedAt &&
      Date.now() - record.verifiedAt.getTime() <= this.resetTtlMs;
    const user = record ? await this.users.findById(record.userId) : null;
    if (!record || !fresh || !user || user.status !== 'active') {
      throw new BadRequestException({
        code: ErrorCode.OTP_INVALID,
        message:
          'This reset session is invalid or has expired. Please start again.',
      });
    }

    // Hashed only once the token is known good: a junk token costs no bcrypt.
    const passwordHash = await this.hasher.hash(newPassword);
    await this.dataSource.transaction(async (m) => {
      await m.update(
        User,
        { id: user.id },
        {
          passwordHash,
          tokenVersion: () => 'token_version + 1',
          // Proving the inbox lifts a password lockout.
          signinFailures: 0,
          signinFailuresSince: null,
        },
      );
      await m.update(
        PasswordResetOtp,
        { userId: user.id, usedAt: IsNull() },
        { usedAt: new Date() },
      );
      await this.tokens.revokeAllForUser(user.id, undefined, m);
    });

    await this.audit.record({
      actorUserId: user.id,
      action: 'auth.password_reset',
      targetType: 'user',
      targetId: user.id,
    });
    return { reset: true };
  }

  private locked() {
    return new BadRequestException({
      code: ErrorCode.OTP_LOCKED,
      message: 'Too many incorrect attempts. Request a new code.',
    });
  }
}
