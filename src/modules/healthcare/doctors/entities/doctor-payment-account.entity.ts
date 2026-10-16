import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { Doctor } from './doctor.entity';
import {
  PAYMENT_ACCOUNT_KINDS,
  PaymentAccountKind,
} from '../../../../common/payments/payment-account.validation';

/**
 * Where patients transfer video-consultation fees: the doctor's own account
 * (MetroMatrix holds nothing). Same shape and validation as a store's; at most
 * 4 active; snapshotted onto each transfer appointment.
 */
@Entity('doctor_payment_accounts')
@Index(['doctorId', 'accountNumber'], { unique: true })
export class DoctorPaymentAccount extends BaseEntity {
  @Index()
  @Column({ type: 'uuid', name: 'doctor_id' })
  doctorId!: string;

  @ManyToOne(() => Doctor, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'doctor_id' })
  doctor?: Doctor;

  @Column({
    type: 'enum',
    enum: PAYMENT_ACCOUNT_KINDS,
    enumName: 'doctor_payment_account_kind',
  })
  kind!: PaymentAccountKind;

  @Column({ type: 'varchar', length: 80, name: 'account_title' })
  accountTitle!: string;

  @Column({ type: 'varchar', length: 34, name: 'account_number' })
  accountNumber!: string;

  @Column({ type: 'varchar', length: 80, name: 'bank_name', nullable: true })
  bankName!: string | null;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive!: boolean;
}
