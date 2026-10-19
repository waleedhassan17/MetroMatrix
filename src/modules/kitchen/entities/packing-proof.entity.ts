import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/base/base.entity';
import { FoodOrder } from '../../food/orders/entities/food-order.entity';

/**
 * A photo of the packed order before it leaves. `ai_check` is advisory
 * only (packing_check@1: { expectedItems, detectedItems, match, confidence }).
 */
@Entity('packing_proofs')
@Index(['orderId'], { unique: true })
export class PackingProof extends BaseEntity {
  @Column({ type: 'uuid', name: 'order_id' })
  orderId!: string;

  @ManyToOne(() => FoodOrder, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order?: FoodOrder;

  @Column({ type: 'varchar', length: 500, name: 'photo_url' })
  photoUrl!: string;

  @Column({
    type: 'enum',
    enum: ['vendor', 'rider'],
    enumName: 'packing_taken_by',
    name: 'taken_by',
  })
  takenBy!: 'vendor' | 'rider';

  @Column({ type: 'uuid', name: 'taken_by_user_id', nullable: true })
  takenByUserId!: string | null;

  @Column({ type: 'jsonb', name: 'ai_check', nullable: true })
  aiCheck!: Record<string, unknown> | null;
}
