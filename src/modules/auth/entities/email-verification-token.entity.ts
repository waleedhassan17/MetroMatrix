import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/base/base.entity';
import { User } from '../../users/entities/user.entity';

/**
 * An emailed verification link's token (FinMatrix's flow). Only its SHA-256
 * is stored (common/crypto/hash.ts): the token is 32 random bytes, so a plain
 * hash is enough. Issuing a new link retires the previous one; `created_at`
 * drives the 60 s resend cooldown.
 */
@Entity('email_verification_tokens')
@Index(['userId', 'createdAt'])
export class EmailVerificationToken extends BaseEntity {
  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64, name: 'token_hash' })
  tokenHash!: string;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt!: Date;

  /** Set when the link is spent or superseded by a newer one. */
  @Column({ type: 'timestamptz', name: 'used_at', nullable: true })
  usedAt!: Date | null;
}
