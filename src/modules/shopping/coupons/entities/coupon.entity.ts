import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { Store } from '../../stores/entities/store.entity';

export const COUPON_TYPES = ['percent', 'fixed'] as const;
export type CouponType = (typeof COUPON_TYPES)[number];

/**
 * A store's own discount code — there are no platform-wide coupons.
 * `used_count` only moves through a conditional UPDATE (`… WHERE used_count <
 * usage_limit`), so two checkouts can never both take the last use; the
 * CHECK backs that up.
 */
@Entity('coupons')
@Index(['storeId', 'code'], { unique: true })
@Check(
  'CHK_coupons_value',
  `"value" > 0 AND ("type" <> 'percent' OR "value" <= 100)`,
)
@Check('CHK_coupons_window', '"ends_at" > "starts_at"')
@Check(
  'CHK_coupons_usage',
  '"used_count" >= 0 AND ("usage_limit" IS NULL OR "used_count" <= "usage_limit")',
)
@Check('CHK_coupons_amounts', '"min_order" >= 0 AND "per_user_limit" >= 1')
export class Coupon extends BaseEntity {
  @Column({ type: 'uuid', name: 'store_id' })
  storeId!: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'store_id' })
  store?: Store;

  /** Upper-case, unique per store. */
  @Column({ type: 'varchar', length: 20 })
  code!: string;

  @Column({ type: 'enum', enum: COUPON_TYPES, enumName: 'coupon_type' })
  type!: CouponType;

  /** Percent (1–100) or rupees. */
  @Column({ type: 'int' })
  value!: number;

  @Column({ type: 'int', name: 'min_order', default: 0 })
  minOrder!: number;

  @Column({ type: 'int', name: 'max_discount', nullable: true })
  maxDiscount!: number | null;

  @Column({ type: 'timestamptz', name: 'starts_at' })
  startsAt!: Date;

  @Column({ type: 'timestamptz', name: 'ends_at' })
  endsAt!: Date;

  @Column({ type: 'int', name: 'usage_limit', nullable: true })
  usageLimit!: number | null;

  @Column({ type: 'int', name: 'per_user_limit', default: 1 })
  perUserLimit!: number;

  @Column({ type: 'int', name: 'used_count', default: 0 })
  usedCount!: number;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive!: boolean;
}
