import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  lockedForSeconds,
  recordFailure,
  resetFailures,
} from './abuse-counters';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { randomInt } from 'crypto';
import { DataSource, IsNull, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { AdminRecoveryCode } from './entities/admin-recovery-code.entity';
import { open, seal } from '../../common/crypto/secret-box';
import { hashCode, verifyCode } from '../../common/crypto/otp';
import { ErrorCode } from '../../common/errors/codes';

const ISSUER = 'MetroMatrix';
const RECOVERY_PURPOSE = 'admin-recovery';
const RECOVERY_CODE_COUNT = 10;
/** No 0/o/1/l/i: codes get read off paper. */
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** ±1 step (30 s) of clock drift between the server and the phone. */
const totp = authenticator.clone({ window: 1 });

/** Wrong codes per account within the window before sign-in step 2 answers 429. */
export const TOTP_MAX_FAILURES = 5;

export interface TotpEnrolment {
  otpauthUri: string;
  /** PNG data URL of the otpauth URI, for the admin console to show. */
  qrDataUrl: string;
  /** The base32 secret, for typing into an authenticator by hand. */
  secret: string;
}

/**
 * Admin second factor: TOTP (RFC 6238) via otplib, secrets sealed with
 * AES-256-GCM, plus single-use recovery codes.
 */
@Injectable()
export class TotpService {
  private readonly encKey: string;
  private readonly pepper: string;

  constructor(
    @InjectRepository(AdminRecoveryCode)
    private readonly recoveryRepo: Repository<AdminRecoveryCode>,
    private readonly dataSource: DataSource,
    config: ConfigService,
  ) {
    this.encKey = config.getOrThrow<string>('auth.totpEncKey');
    this.pepper = config.getOrThrow<string>('auth.otpPepper');
  }

  /**
   * Start (or restart) enrolment: a new secret, held as *pending* until a
   * code from it is confirmed — an unfinished rotation never locks the admin
   * out of the secret that still works.
   */
  async enrol(user: User): Promise<TotpEnrolment> {
    const secret = totp.generateSecret(20);
    await this.dataSource
      .getRepository(User)
      .update(
        { id: user.id },
        { totpPendingSecretEnc: seal(secret, this.encKey) },
      );
    const otpauthUri = totp.keyuri(user.email, ISSUER, secret);
    return {
      otpauthUri,
      qrDataUrl: await QRCode.toDataURL(otpauthUri),
      secret,
    };
  }

  /**
   * Prove the authenticator works: promote the pending secret and issue a
   * fresh set of recovery codes (returned once, stored hashed).
   */
  async confirm(
    user: User,
    code: string,
  ): Promise<{ recoveryCodes: string[] }> {
    const fresh = await this.dataSource
      .getRepository(User)
      .findOneByOrFail({ id: user.id });
    if (!fresh.totpPendingSecretEnc) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Start enrolment first (POST /admin/me/totp/enrol).',
      });
    }
    const step = this.matchedStep(fresh.totpPendingSecretEnc, code);
    if (step === null) {
      // 400, not 401: this route is called with a session the app should keep.
      throw new BadRequestException({
        code: ErrorCode.TOTP_INVALID,
        message:
          'That code is not right. Check the time on your phone and try again.',
      });
    }

    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
      this.recoveryCode(),
    );
    await this.dataSource.transaction(async (m) => {
      await m.update(
        User,
        { id: user.id },
        {
          totpSecretEnc: fresh.totpPendingSecretEnc,
          totpPendingSecretEnc: null,
          totpEnabled: true,
          // The confirming code counts as used: it can't then sign in (step 2
          // only accepts a later step). Never moves the mark backwards.
          totpLastStep: () =>
            `GREATEST(COALESCE(totp_last_step, ${step}), ${step})`,
        },
      );
      await m.delete(AdminRecoveryCode, { userId: user.id });
      await m.insert(
        AdminRecoveryCode,
        recoveryCodes.map((c) => ({
          userId: user.id,
          codeHash: hashCode(
            this.pepper,
            RECOVERY_PURPOSE,
            user.id,
            normalizeRecovery(c),
          ),
          usedAt: null,
        })),
      );
    });
    return { recoveryCodes };
  }

  /** A current code from the enrolled authenticator? */
  checkCode(user: User, code: string): boolean {
    if (!user.totpEnabled || !user.totpSecretEnc) return false;
    return totp.check(code, open(user.totpSecretEnc, this.encKey));
  }

  /**
   * Admin sign-in step 2. Throws unless a valid code — or an unused recovery
   * code, which is spent — is given.
   *
   * - A code is accepted once: its time step must be later than the last one
   *   accepted (users.totp_last_step), so a code seen over a shoulder or in a
   *   log can't be replayed inside its 30–90 s window.
   * - 5 wrong codes (TOTP or recovery) in 15 minutes answer 429 RATE_LIMITED
   *   with `retryAfter` until the window ends, even for a right code.
   *   AuthService.adminTotp then retires the challenge.
   */
  async verifySignin(
    user: User,
    input: { code?: string; recoveryCode?: string },
  ): Promise<'totp' | 'recovery_code'> {
    if (!user.totpEnabled || !user.totpSecretEnc) {
      throw new ForbiddenException({
        code: ErrorCode.TOTP_REQUIRED,
        message: 'Set up your authenticator app before signing in.',
        details: { enrolmentRequired: true },
      });
    }
    const wait = lockedForSeconds(
      user.totpFailures,
      user.totpFailuresSince,
      TOTP_MAX_FAILURES,
    );
    if (wait > 0) throw this.tooManyAttempts(wait);

    let method: 'totp' | 'recovery_code' | null = null;
    if (input.code) {
      const step = this.matchedStep(user.totpSecretEnc, input.code);
      if (step !== null && (await this.claimStep(user.id, step))) {
        method = 'totp';
      }
    }
    if (
      !method &&
      input.recoveryCode &&
      (await this.spendRecoveryCode(user.id, input.recoveryCode))
    ) {
      method = 'recovery_code';
    }

    if (method) {
      if (user.totpFailures > 0) {
        await resetFailures(this.dataSource, user.id, 'totp');
      }
      return method;
    }

    const { count, since } = await recordFailure(
      this.dataSource,
      user.id,
      'totp',
    );
    const lockedFor = lockedForSeconds(count, since, TOTP_MAX_FAILURES);
    if (lockedFor > 0) throw this.tooManyAttempts(lockedFor);
    throw new UnauthorizedException({
      code: ErrorCode.TOTP_INVALID,
      message: 'That code is not right.',
    });
  }

  /** The 30 s counter a code belongs to (±1 step of drift), or null. */
  private matchedStep(secretEnc: string, code: string): number | null {
    // One clock reading for both, so a step boundary can't fall between them.
    const now = Date.now();
    const at = totp.clone({ epoch: now });
    const delta = at.checkDelta(code, open(secretEnc, this.encKey));
    if (delta === null) return null;
    return Math.floor(now / 1000 / at.allOptions().step) + delta;
  }

  /** Accept this step only if it's later than the last one accepted (atomic). */
  private async claimStep(userId: string, step: number): Promise<boolean> {
    const res = await this.dataSource
      .createQueryBuilder()
      .update(User)
      .set({ totpLastStep: String(step) })
      .where(
        'id = :id AND (totp_last_step IS NULL OR totp_last_step < :step)',
        {
          id: userId,
          step,
        },
      )
      .execute();
    return (res.affected ?? 0) > 0;
  }

  private tooManyAttempts(retryAfter: number) {
    return new HttpException(
      {
        code: ErrorCode.RATE_LIMITED,
        message: `Too many incorrect codes. Sign in again in ${Math.ceil(retryAfter / 60)} minutes.`,
        details: { retryAfter },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  remainingRecoveryCodes(userId: string): Promise<number> {
    return this.recoveryRepo.count({ where: { userId, usedAt: IsNull() } });
  }

  private async spendRecoveryCode(
    userId: string,
    raw: string,
  ): Promise<boolean> {
    const candidates = await this.recoveryRepo.find({
      where: { userId, usedAt: IsNull() },
    });
    const normalized = normalizeRecovery(raw);
    for (const c of candidates) {
      if (
        verifyCode(
          this.pepper,
          RECOVERY_PURPOSE,
          userId,
          normalized,
          c.codeHash,
        )
      ) {
        // Conditional on still unused: a code can be spent exactly once.
        const res = await this.recoveryRepo.update(
          { id: c.id, usedAt: IsNull() },
          { usedAt: new Date() },
        );
        return (res.affected ?? 0) > 0;
      }
    }
    return false;
  }

  private recoveryCode(): string {
    const pick = () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
    const part = () => Array.from({ length: 4 }, pick).join('');
    return `${part()}-${part()}`;
  }
}

/** Case, spaces and dashes don't matter when an admin types a code. */
function normalizeRecovery(code: string): string {
  return code.toLowerCase().replace(/[\s-]/g, '');
}
