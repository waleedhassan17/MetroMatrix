import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { Business } from '../../../businesses/entities/business.entity';

/** numeric → number (pg returns numerics as strings to keep precision). */
const decimal = {
  to: (v?: number | null) => v,
  from: (v: string | null) => (v === null ? null : parseFloat(v)),
};

export interface StoreSocials {
  instagram?: string;
  facebook?: string;
  tiktok?: string;
  website?: string;
  whatsapp?: string;
}

/**
 * A shopping partner's storefront: one per approved shopping business,
 * created inside the approval transaction. Money columns are integer rupees.
 */
@Entity('stores')
@Check('CHK_stores_return_window', '"return_window_days" BETWEEN 0 AND 30')
@Check(
  'CHK_stores_money',
  '"cod_limit" >= 0 AND "shipping_flat_fee" >= 0 AND ("free_shipping_over" IS NULL OR "free_shipping_over" > 0)',
)
@Check(
  'CHK_stores_dispatch',
  '"dispatch_days_min" >= 0 AND "dispatch_days_min" <= "dispatch_days_max"',
)
export class Store extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'uuid', name: 'business_id' })
  businessId!: string;

  @ManyToOne(() => Business, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'business_id' })
  business?: Business;

  @Index({ unique: true })
  @Column({ type: 'citext' })
  slug!: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  tagline!: string | null;

  @Column({ type: 'text', nullable: true })
  about!: string | null;

  @Column({ type: 'varchar', length: 500, name: 'logo_url', nullable: true })
  logoUrl!: string | null;

  @Column({ type: 'varchar', length: 500, name: 'cover_url', nullable: true })
  coverUrl!: string | null;

  /** `#RRGGBB`, AA-readable with `onBrandColor` text on it. */
  @Column({ type: 'varchar', length: 7, name: 'brand_color' })
  brandColor!: string;

  /** White or ink — whichever reads better on the brand colour. */
  @Column({ type: 'varchar', length: 7, name: 'on_brand_color' })
  onBrandColor!: string;

  @Column({ type: 'jsonb' })
  socials!: StoreSocials;

  @Column({ type: 'int', name: 'return_window_days', default: 7 })
  returnWindowDays!: number;

  @Column({ type: 'boolean', name: 'cod_enabled', default: true })
  codEnabled!: boolean;

  @Column({ type: 'int', name: 'cod_limit', default: 10000 })
  codLimit!: number;

  @Column({ type: 'int', name: 'shipping_flat_fee', default: 150 })
  shippingFlatFee!: number;

  @Column({ type: 'int', name: 'free_shipping_over', nullable: true })
  freeShippingOver!: number | null;

  /** Empty = delivers nationwide. Compared case-insensitively. */
  @Column({ type: 'text', array: true, name: 'delivery_cities' })
  deliveryCities!: string[];

  @Column({ type: 'int', name: 'dispatch_days_min', default: 1 })
  dispatchDaysMin!: number;

  @Column({ type: 'int', name: 'dispatch_days_max', default: 3 })
  dispatchDaysMax!: number;

  @Column({ type: 'boolean', name: 'is_paused', default: false })
  isPaused!: boolean;

  @Column({
    type: 'varchar',
    length: 200,
    name: 'pause_message',
    nullable: true,
  })
  pauseMessage!: string | null;

  @Column({
    type: 'numeric',
    precision: 3,
    scale: 2,
    name: 'rating_avg',
    default: 0,
    transformer: decimal,
  })
  ratingAvg!: number;

  @Column({ type: 'int', name: 'rating_count', default: 0 })
  ratingCount!: number;

  /** Set by admins only. */
  @Column({ type: 'boolean', name: 'is_featured', default: false })
  isFeatured!: boolean;

  /** The low-stock digest job's "already sent today" marker. */
  @Column({ type: 'date', name: 'low_stock_digest_on', nullable: true })
  lowStockDigestOn!: string | null;
}
