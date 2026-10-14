import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

/**
 * Denylist for signed-out ACCESS tokens (and spent admin TOTP challenges).
 * Access tokens are stateless JWTs, so revoking the refresh token alone leaves
 * them valid until `exp` (≤15 min); sign-out records the token's jti here and
 * JwtStrategy rejects it. Rows are only meaningful until `expires_at` and are
 * pruned daily by AuthMaintenanceService.
 */
@Entity('revoked_access_tokens')
export class RevokedAccessToken {
  @PrimaryColumn({ type: 'varchar', length: 64, name: 'jti' })
  jti!: string;

  @Index()
  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @Index()
  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt!: Date;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
