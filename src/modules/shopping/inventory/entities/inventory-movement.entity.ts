import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ProductVariant } from '../../products/entities/product-variant.entity';

export const INVENTORY_REASONS = [
  'order',
  'cancel',
  'return_restock',
  'manual',
  'bulk',
] as const;
export type InventoryReason = (typeof INVENTORY_REASONS)[number];

/**
 * Append-only stock ledger: every change to a variant's stock writes one row,
 * in the same transaction as the change, with the balance it left behind.
 * Summing `delta` over a variant's rows reproduces its stock.
 */
@Entity('inventory_movements')
@Index(['variantId', 'createdAt'])
export class InventoryMovement {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'variant_id' })
  variantId!: string;

  @ManyToOne(() => ProductVariant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'variant_id' })
  variant?: ProductVariant;

  @Column({ type: 'int' })
  delta!: number;

  @Column({
    type: 'enum',
    enum: INVENTORY_REASONS,
    enumName: 'inventory_reason',
  })
  reason!: InventoryReason;

  /** What caused it: `store_order`, `return_request`, `product`… */
  @Column({ type: 'varchar', length: 32, name: 'ref_type', nullable: true })
  refType!: string | null;

  @Column({ type: 'uuid', name: 'ref_id', nullable: true })
  refId!: string | null;

  /** Null for system actions (jobs). */
  @Column({ type: 'uuid', name: 'actor_user_id', nullable: true })
  actorUserId!: string | null;

  @Column({ type: 'int', name: 'balance_after' })
  balanceAfter!: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
