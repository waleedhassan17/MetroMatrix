import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
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
const STEP_SECONDS = 30;

/** The time-step `code` belongs to under `secret`, or null if it is wrong. */
function matchStep(code: string, secret: string): number | null {
  const delta = totp.checkDelta(code, secret);
  if (delta === null) return null;
  return Math.floor(Date.now() / 1000 / STEP_SECONDS) + delta;
}

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
    const step = matchStep(code, open(fresh.totpPendingSecretEnc, this.encKey));
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
      // A new secret, so its codes can't be replays of the old one's; the
      // step is recorded (never lowered) so this very code can't sign in.
      await m.update(
        User,
        { id: user.id },
        {
          totpSecretEnc: fresh.totpPendingSecretEnc,
          totpPendingSecretEnc: null,
          totpEnabled: true,
          totpLastStep: () => `GREATEST(COALESCE(totp_last_step, 0), ${step})`,
        },
      );
      await m.delete(AdminRecoveryCode, { userId: user.id });
      await m.insert(AdminRecoveryCode, this.recoveryRows(user, recoveryCodes));
    });
    return { recoveryCodes };
  }

  private recoveryRows(user: User, codes: string[]) {
    return codes.map((c) => ({
      userId: user.id,
      codeHash: hashCode(
        this.pepper,
        RECOVERY_PURPOSE,
        user.id,
        normalizeRecovery(c),
      ),
      usedAt: null,
    }));
  }

  /**
   * A current code from the enrolled authenticator, never used before? The
   * code's time-step is spent: the same code (or an older one) is refused
   * from then on — at sign-in, for a rotation and for step-up alike.
   */
  async spendCode(user: User, code: string): Promise<boolean> {
    if (!user.totpEnabled || !user.totpSecretEnc) return false;
    const step = matchStep(code, open(user.totpSecretEnc, this.encKey));
    return step !== null && this.spendStep(user, step);
  }

  /**
   * One conditional UPDATE: of two requests with the same code, exactly one
   * wins. The loaded row is updated too, so a later save() of it cannot
   * write the old step back.
   */
  private async spendStep(user: User, step: number): Promise<boolean> {
    const res = await this.dataSource
      .getRepository(User)
      .createQueryBuilder()
      .update()
      .set({ totpLastStep: step })
      .where('id = :id', { id: user.id })
      .andWhere('(totp_last_step IS NULL OR totp_last_step < :step)', { step })
      .execute();
    if (!res.affected) return false;
    user.totpLastStep = step;
    return true;
  }

  /**
   * Admin sign-in step 2. Throws unless a valid code — or an unused recovery
   * code, which is spent — is given.
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
    if (input.code && (await this.spendCode(user, input.code))) return 'totp';
    if (
      input.recoveryCode &&
      (await this.spendRecoveryCode(user.id, input.recoveryCode))
    ) {
      return 'recovery_code';
    }
    throw new UnauthorizedException({
      code: ErrorCode.TOTP_INVALID,
      message: 'That code is not right.',
    });
  }

  /** A fresh set of recovery codes (returned once); the old set stops working. */
  async regenerateRecoveryCodes(
    user: User,
  ): Promise<{ recoveryCodes: string[] }> {
    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
      this.recoveryCode(),
    );
    await this.dataSource.transaction(async (m) => {
      await m.delete(AdminRecoveryCode, { userId: user.id });
      await m.insert(AdminRecoveryCode, this.recoveryRows(user, recoveryCodes));
    });
    return { recoveryCodes };
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
