import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/base/base.entity';
import {
  USER_ROLES,
  USER_STATUSES,
  UserRole,
  UserStatus,
} from '../../../types';

@Entity('users')
export class User extends BaseEntity {
  /** citext: unique regardless of case. Stored lower-cased all the same. */
  @Index({ unique: true })
  @Column({ type: 'citext' })
  email!: string;

  /** Null for Google-only accounts (and after account deletion). */
  @Column({
    type: 'varchar',
    length: 255,
    name: 'password_hash',
    nullable: true,
  })
  passwordHash!: string | null;

  /** Null only once an account is deleted and anonymised. */
  @Column({ type: 'varchar', length: 80, name: 'display_name', nullable: true })
  displayName!: string | null;

  /** Canonical +923XXXXXXXXX (see common/validation/phone.ts). */
  @Column({ type: 'varchar', length: 16, nullable: true })
  phone!: string | null;

  @Column({ type: 'enum', enum: USER_ROLES, enumName: 'user_role' })
  role!: UserRole;

  /** Reserved for riders (Food chunk), who sign in by username. */
  @Index({ unique: true })
  @Column({ type: 'citext', nullable: true })
  username!: string | null;

  @Column({ type: 'boolean', name: 'is_email_verified', default: false })
  isEmailVerified!: boolean;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255, name: 'google_sub', nullable: true })
  googleSub!: string | null;

  @Column({ type: 'varchar', length: 500, name: 'avatar_url', nullable: true })
  avatarUrl!: string | null;

  @Column({
    type: 'enum',
    enum: USER_STATUSES,
    enumName: 'user_status',
    default: 'active',
  })
  status!: UserStatus;

  /** Admins only. AES-256-GCM with TOTP_ENC_KEY (common/crypto/secret-box.ts). */
  @Column({
    type: 'varchar',
    length: 255,
    name: 'totp_secret_enc',
    nullable: true,
  })
  totpSecretEnc!: string | null;

  /**
   * A secret being enrolled, promoted to `totp_secret_enc` only once a code
   * from it is confirmed — so rotating a TOTP never locks the admin out.
   */
  @Column({
    type: 'varchar',
    length: 255,
    name: 'totp_pending_secret_enc',
    nullable: true,
  })
  totpPendingSecretEnc!: string | null;

  @Column({ type: 'boolean', name: 'totp_enabled', default: false })
  totpEnabled!: boolean;

  @Column({ type: 'timestamptz', name: 'last_login_at', nullable: true })
  lastLoginAt!: Date | null;

  /**
   * Stamped into every access token (`ver`). Bumping it — password reset,
   * disable, delete — kills every outstanding access token at once, without
   * waiting the 15 minutes for them to expire and without a per-request query.
   */
  @Column({ type: 'int', name: 'token_version', default: 0 })
  tokenVersion!: number;

  /** Soft delete: the row stays (audit, FKs) with its PII anonymised. */
  @Column({ type: 'timestamptz', name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;
}
