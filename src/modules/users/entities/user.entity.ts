import { Check, Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/base/base.entity';
import {
  USER_ROLES,
  USER_STATUSES,
  UserRole,
  UserStatus,
} from '../../../types';
import { ADMIN_PERMISSION_KEYS } from '../../../types/admin-permissions';

/** The CHECK's allow-list, generated from the one list of keys. */
const PERMISSION_LIST = `'${JSON.stringify(ADMIN_PERMISSION_KEYS)}'::jsonb`;

@Entity('users')
// Signups over time (admin overview, analytics).
@Index('IDX_users_created_at', ['createdAt'])
@Check(
  'CHK_users_admin_permissions_array',
  `jsonb_typeof("admin_permissions") = 'array'`,
)
@Check(
  'CHK_users_admin_permissions_known',
  `"admin_permissions" <@ ${PERMISSION_LIST}`,
)
@Check(
  'CHK_users_admin_permissions_admin_only',
  `"role" = 'admin' OR "admin_permissions" = '[]'::jsonb`,
)
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

  /**
   * A regular admin's grants (types/admin-permissions.ts). Always `[]` for
   * everyone else — a super admin holds every permission implicitly.
   */
  @Column({
    type: 'jsonb',
    name: 'admin_permissions',
    default: () => "'[]'",
  })
  adminPermissions!: string[];

  /**
   * Set when a super admin creates the account or resets its password: the
   * session may only change the password until it is cleared.
   */
  @Column({ type: 'boolean', name: 'must_change_password', default: false })
  mustChangePassword!: boolean;

  /**
   * The last TOTP time-step (unix seconds / 30) this admin spent. A code is
   * accepted only for a later step, so it can never be replayed.
   */
  @Column({
    type: 'bigint',
    name: 'totp_last_step',
    nullable: true,
    transformer: {
      to: (v: number | null) => v,
      from: (v: string | null) => (v === null ? null : Number(v)),
    },
  })
  totpLastStep!: number | null;

  /** Soft delete: the row stays (audit, FKs) with its PII anonymised. */
  @Column({ type: 'timestamptz', name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;
}
