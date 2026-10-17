import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { Business } from '../../../businesses/entities/business.entity';
import {
  PAYMENT_ACCOUNT_KINDS,
  PaymentAccountKind,
} from '../../../../common/payments/payment-account.validation';

/** Where customers transfer to: the vendor's own accounts (MetroMatrix never holds money). */
@Entity('vendor_payment_accounts')
@Index(['businessId', 'accountNumber'], { unique: true })
export class VendorPaymentAccount extends BaseEntity {
  @Column({ type: 'uuid', name: 'business_id' })
  businessId!: string;

  @ManyToOne(() => Business, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'business_id' })
  business?: Business;

  @Column({
    type: 'enum',
    enum: PAYMENT_ACCOUNT_KINDS,
    enumName: 'vendor_payment_account_kind',
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
