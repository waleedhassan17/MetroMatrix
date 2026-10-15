import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { Store } from './store.entity';
import {
  PAYMENT_ACCOUNT_KINDS,
  PaymentAccountKind,
} from '../../../../common/payments/payment-account.validation';

/**
 * Where customers transfer money for a transfer order. The store's own
 * account — MetroMatrix never holds money. Snapshotted onto each transfer
 * order at checkout, so editing an account never changes a past order.
 * At most 4 active per store (service-enforced).
 */
@Entity('store_payment_accounts')
@Index(['storeId', 'accountNumber'], { unique: true })
export class StorePaymentAccount extends BaseEntity {
  @Index()
  @Column({ type: 'uuid', name: 'store_id' })
  storeId!: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'store_id' })
  store?: Store;

  @Column({
    type: 'enum',
    enum: PAYMENT_ACCOUNT_KINDS,
    enumName: 'store_payment_account_kind',
  })
  kind!: PaymentAccountKind;

  @Column({ type: 'varchar', length: 80, name: 'account_title' })
  accountTitle!: string;

  /** IBAN for `bank`; the +92 mobile / Raast ID otherwise. */
  @Column({ type: 'varchar', length: 34, name: 'account_number' })
  accountNumber!: string;

  @Column({ type: 'varchar', length: 80, name: 'bank_name', nullable: true })
  bankName!: string | null;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive!: boolean;
}
