// bcryptjs, like the app, so the seeded hash is the one sign-in checks.
import * as bcrypt from 'bcryptjs';
import { DataSource, Not } from 'typeorm';
import { User } from '../../modules/users/entities/user.entity';
import { AdminRecoveryCode } from '../../modules/auth/entities/admin-recovery-code.entity';
import { PASSWORD_REGEX } from '../../common/validation/password';

export interface SeedSuperAdminOptions {
  email: string;
  password: string;
  displayName?: string;
  bcryptRounds?: number;
  /** Re-hash the password of an existing account. Off by default. */
  resetPassword?: boolean;
  /**
   * Clear an existing account's TOTP and recovery codes so its next admin
   * sign-in enrols again — the operator's way back in after a lost phone.
   */
  resetTotp?: boolean;
}

export type SeedOutcome = 'created' | 'updated' | 'unchanged';

/**
 * Create the super admin, or bring an existing account up to super admin.
 * Idempotent. The password is never logged. Unlike FinMatrix's seed, nothing
 * is hard-coded and nothing synchronizes the schema: the migrations must
 * already have run.
 */
export async function seedSuperAdmin(
  ds: DataSource,
  opts: SeedSuperAdminOptions,
): Promise<{ outcome: SeedOutcome; userId: string }> {
  const email = opts.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('SUPER_ADMIN_EMAIL is not a valid email address');
  }
  if (
    opts.password.length < 8 ||
    opts.password.length > 72 ||
    !PASSWORD_REGEX.test(opts.password)
  ) {
    throw new Error(
      'SUPER_ADMIN_PASSWORD must be 8–72 characters with a lower-case letter, an upper-case letter and a digit',
    );
  }
  const rounds = opts.bcryptRounds ?? 12;
  const repo = ds.getRepository(User);
  const existing = await repo.findOne({
    where: { email, status: Not('deleted') },
  });

  if (!existing) {
    const created = await repo.save(
      repo.create({
        email,
        passwordHash: await bcrypt.hash(opts.password, rounds),
        displayName: opts.displayName ?? 'MetroMatrix Admin',
        role: 'super_admin',
        isEmailVerified: true,
        status: 'active',
      }),
    );
    return { outcome: 'created', userId: created.id };
  }

  let changed = false;
  if (existing.role !== 'super_admin') {
    existing.role = 'super_admin';
    changed = true;
  }
  if (existing.status !== 'active') {
    existing.status = 'active';
    changed = true;
  }
  if (!existing.isEmailVerified) {
    existing.isEmailVerified = true;
    changed = true;
  }
  if (opts.resetPassword) {
    existing.passwordHash = await bcrypt.hash(opts.password, rounds);
    existing.tokenVersion += 1;
    changed = true;
  }
  if (opts.resetTotp) {
    existing.totpEnabled = false;
    existing.totpSecretEnc = null;
    existing.totpPendingSecretEnc = null;
    existing.tokenVersion += 1;
    await ds.getRepository(AdminRecoveryCode).delete({ userId: existing.id });
    changed = true;
  }
  if (changed) await repo.save(existing);
  return { outcome: changed ? 'updated' : 'unchanged', userId: existing.id };
}
