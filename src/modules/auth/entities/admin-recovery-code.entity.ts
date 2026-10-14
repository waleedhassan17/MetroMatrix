import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/base/base.entity';
import { User } from '../../users/entities/user.entity';

/**
 * Single-use admin recovery codes — the way back in when the authenticator
 * phone is lost. Ten are issued (and shown once) each time TOTP is confirmed;
 * issuing replaces the old set. Only peppered hashes are stored.
 */
@Entity('admin_recovery_codes')
export class AdminRecoveryCode extends BaseEntity {
  @Index()
  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ type: 'varchar', length: 64, name: 'code_hash' })
  codeHash!: string;

  @Column({ type: 'timestamptz', name: 'used_at', nullable: true })
  usedAt!: Date | null;
}
