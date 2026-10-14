import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/base/base.entity';
import { User } from '../../users/entities/user.entity';

/**
 * A 6-digit email verification code. Only its peppered hash is stored
 * (common/crypto/otp.ts). 10-minute life, 5 attempts, and issuing a new code
 * retires the previous one. `created_at` drives the 60 s resend cooldown.
 */
@Entity('email_verification_otps')
@Index(['userId', 'createdAt'])
export class EmailVerificationOtp extends BaseEntity {
  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ type: 'varchar', length: 64, name: 'otp_hash' })
  otpHash!: string;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt!: Date;

  /** Set when the code is spent, superseded or locked. */
  @Column({ type: 'timestamptz', name: 'used_at', nullable: true })
  usedAt!: Date | null;
}
