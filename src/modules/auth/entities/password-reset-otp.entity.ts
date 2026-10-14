import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/base/base.entity';
import { User } from '../../users/entities/user.entity';

/**
 * Forgot-password OTP flow (FinMatrix's, kept as-is):
 *
 *  1. request  → a 6-digit OTP is generated, its hash stored in `otpHash`.
 *  2. verify   → the OTP is checked; on success `verifiedAt` is set and a
 *                single-use reset token is issued (hash in `resetTokenHash`).
 *  3. reset    → the reset token is exchanged for a password change; `usedAt`
 *                is set so the whole record can never be replayed.
 *
 * Only hashes are stored at rest. `attempts` bounds brute-forcing of the OTP.
 */
@Entity('password_reset_otps')
@Index(['userId', 'createdAt'])
export class PasswordResetOtp extends BaseEntity {
  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ type: 'varchar', length: 64, name: 'otp_hash' })
  otpHash!: string;

  /** Looked up by value in step 3, so unique. */
  @Index({ unique: true })
  @Column({
    type: 'varchar',
    length: 64,
    name: 'reset_token_hash',
    nullable: true,
  })
  resetTokenHash!: string | null;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', name: 'verified_at', nullable: true })
  verifiedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'used_at', nullable: true })
  usedAt!: Date | null;
}
