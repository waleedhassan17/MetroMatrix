import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { Product } from '../../products/entities/product.entity';
import { User } from '../../../users/entities/user.entity';

export const REPORT_REASONS = [
  'counterfeit',
  'prohibited_item',
  'misleading',
  'offensive',
  'wrong_category',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_STATUSES = ['open', 'dismissed', 'actioned'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** A customer flags a product for MetroMatrix to review (admin queue). */
@Entity('product_reports')
// One open report per customer per product (migration-defined partial unique index).
@Index('UQ_product_reports_one_open', { synchronize: false })
@Index(['status', 'createdAt'])
@Index(['productId'])
export class ProductReport extends BaseEntity {
  @Column({ type: 'uuid', name: 'product_id' })
  productId!: string;

  @ManyToOne(() => Product, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product?: Product;

  @Column({ type: 'uuid', name: 'reporter_user_id' })
  reporterUserId!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'reporter_user_id' })
  reporter?: User;

  @Column({
    type: 'enum',
    enum: REPORT_REASONS,
    enumName: 'product_report_reason',
  })
  reason!: ReportReason;

  @Column({ type: 'text', nullable: true })
  details!: string | null;

  @Column({
    type: 'enum',
    enum: REPORT_STATUSES,
    enumName: 'product_report_status',
    default: 'open',
  })
  status!: ReportStatus;

  @Column({ type: 'timestamptz', name: 'resolved_at', nullable: true })
  resolvedAt!: Date | null;

  @Column({ type: 'uuid', name: 'resolved_by', nullable: true })
  resolvedBy!: string | null;

  @Column({ type: 'text', name: 'resolution_note', nullable: true })
  resolutionNote!: string | null;
}
