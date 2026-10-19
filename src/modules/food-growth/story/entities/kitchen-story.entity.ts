import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { FoodBrand } from '../../../food/vendor/entities/food-brand.entity';

export const HYGIENE_STATUSES = ['self_declared', 'verified'] as const;
export type HygieneStatus = (typeof HYGIENE_STATUSES)[number];
export const HYGIENE_METHODS = ['visit', 'video_call'] as const;

/** What the kitchen declares. Every box ticked and a pest control date = "Hygiene self-declared". */
export interface HygieneChecklist {
  gloves: boolean;
  hairnet: boolean;
  cleanWater: boolean;
  separateBoards: boolean;
  fridgeTempLog: boolean;
  /** The last pest control (YYYY-MM-DD). */
  pestControlOn: string | null;
}

/**
 * The kitchen's story on its page, and its hygiene badge. `hygiene_status`
 * is null until the checklist is complete; `self_declared` is the vendor's
 * word; only staff set `verified` (after a visit or a video call), and any
 * later change to the checklist drops it back to self-declared.
 */
@Entity('kitchen_stories')
@Index('UQ_kitchen_stories_brand', ['brandId'], { unique: true })
@Index('IDX_kitchen_stories_hygiene', ['hygieneStatus', 'declaredAt'])
export class KitchenStory extends BaseEntity {
  @Column({ type: 'uuid', name: 'brand_id' })
  brandId!: string;

  @ManyToOne(() => FoodBrand, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'brand_id' })
  brand?: FoodBrand;

  @Column({ type: 'text', nullable: true })
  story!: string | null;

  @Column({ type: 'varchar', length: 80, name: 'cook_name', nullable: true })
  cookName!: string | null;

  @Column({ type: 'text', name: 'video_url', nullable: true })
  videoUrl!: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  photos!: string[];

  @Column({ type: 'jsonb', name: 'hygiene_checklist', nullable: true })
  hygieneChecklist!: HygieneChecklist | null;

  @Column({
    type: 'enum',
    enum: HYGIENE_STATUSES,
    enumName: 'hygiene_status',
    name: 'hygiene_status',
    nullable: true,
  })
  hygieneStatus!: HygieneStatus | null;

  /** When the checklist was last completed (the verification queue's order). */
  @Column({ type: 'timestamptz', name: 'declared_at', nullable: true })
  declaredAt!: Date | null;

  @Column({ type: 'uuid', name: 'verified_by', nullable: true })
  verifiedBy!: string | null;

  @Column({ type: 'timestamptz', name: 'verified_at', nullable: true })
  verifiedAt!: Date | null;

  @Column({
    type: 'enum',
    enum: HYGIENE_METHODS,
    enumName: 'hygiene_method',
    name: 'verified_method',
    nullable: true,
  })
  verifiedMethod!: (typeof HYGIENE_METHODS)[number] | null;

  @Column({
    type: 'varchar',
    length: 300,
    name: 'verified_note',
    nullable: true,
  })
  verifiedNote!: string | null;
}
