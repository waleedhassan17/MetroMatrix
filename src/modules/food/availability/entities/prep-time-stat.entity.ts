import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { Branch } from '../../vendor/entities/branch.entity';

export const SIZE_BUCKETS = ['1-2', '3-5', '6+'] as const;
export type SizeBucket = (typeof SIZE_BUCKETS)[number];

export const sizeBucketOf = (items: number): SizeBucket =>
  items <= 2 ? '1-2' : items <= 5 ? '3-5' : '6+';

/**
 * How long this kitchen really takes, accepted → ready over the last 30
 * days, per local hour and order size (Chunk 5 smart ETA). Quotes use p75
 * once a bucket has 20 samples, else the vendor's prep_minutes.
 */
@Entity('prep_time_stats')
@Index(['branchId', 'hourBucket', 'sizeBucket'], { unique: true })
export class PrepTimeStat extends BaseEntity {
  @Column({ type: 'uuid', name: 'branch_id' })
  branchId!: string;

  @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'branch_id' })
  branch?: Branch;

  @Column({ type: 'smallint', name: 'hour_bucket' })
  hourBucket!: number;

  @Column({ type: 'varchar', length: 4, name: 'size_bucket' })
  sizeBucket!: SizeBucket;

  @Column({ type: 'smallint', name: 'p50_minutes' })
  p50Minutes!: number;

  @Column({ type: 'smallint', name: 'p75_minutes' })
  p75Minutes!: number;

  @Column({ type: 'int' })
  samples!: number;
}
