import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/base/base.entity';
import { User } from '../../users/entities/user.entity';

/**
 * One row per refresh token ever issued. Tokens are opaque random strings;
 * only their SHA-256 is stored.
 *
 * A `family` is one signed-in device: sign-in starts a family, each refresh
 * revokes the presented token and issues its successor in the same family
 * (`replaced_by_id` links them). Presenting a token that was already rotated
 * away — after the short grace window — means two parties hold the same
 * session, so the whole family is revoked (RefreshToken reuse detection).
 */
@Entity('refresh_tokens')
@Index(['familyId'])
export class RefreshToken extends BaseEntity {
  @Index()
  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ type: 'uuid', name: 'family_id' })
  familyId!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64, name: 'token_hash' })
  tokenHash!: string;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', name: 'revoked_at', nullable: true })
  revokedAt!: Date | null;

  /** The token this one was rotated into. Set only by a refresh. */
  @Column({ type: 'uuid', name: 'replaced_by_id', nullable: true })
  replacedById!: string | null;

  @Column({ type: 'varchar', length: 255, name: 'user_agent', nullable: true })
  userAgent!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip!: string | null;

  /**
   * `app` (body tokens, /auth/refresh-token) or `admin_web` (the console's
   * HttpOnly cookie, /auth/web/*). Each endpoint refuses the other kind.
   */
  @Column({ type: 'varchar', length: 16, default: 'app' })
  client!: 'app' | 'admin_web';

  /** When the family signed in — the console's absolute session limit. */
  @Column({ type: 'timestamptz', name: 'session_started_at', nullable: true })
  sessionStartedAt!: Date | null;
}
