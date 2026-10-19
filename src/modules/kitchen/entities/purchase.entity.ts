import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/base/base.entity';
import { Branch } from '../../food/vendor/entities/branch.entity';
import { User } from '../../users/entities/user.entity';
import { numeric } from '../common/numeric';
import { KitchenIngredient } from './kitchen-ingredient.entity';
import { StockBatch } from './stock-batch.entity';
import { Supplier } from './supplier.entity';

export const PURCHASE_SOURCES = ['manual', 'voice', 'receipt_scan'] as const;
export type PurchaseSource = (typeof PURCHASE_SOURCES)[number];

/** A shopping trip / supplier bill. `total` = Σ line totals, rupees. */
@Entity('purchases')
@Index(['branchId', 'purchasedAt'])
@Check('CHK_purchases_total', '"total" >= 0')
export class Purchase extends BaseEntity {
  @Column({ type: 'uuid', name: 'branch_id' })
  branchId!: string;

  @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'branch_id' })
  branch?: Branch;

  @Column({ type: 'uuid', name: 'supplier_id', nullable: true })
  supplierId!: string | null;

  @ManyToOne(() => Supplier, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'supplier_id' })
  supplier?: Supplier;

  @Column({ type: 'timestamptz', name: 'purchased_at' })
  purchasedAt!: Date;

  @Column({ type: 'int' })
  total!: number;

  /** A private `receipt` upload. */
  @Column({ type: 'varchar', length: 500, name: 'receipt_url', nullable: true })
  receiptUrl!: string | null;

  @Column({
    type: 'enum',
    enum: PURCHASE_SOURCES,
    enumName: 'purchase_source',
    default: 'manual',
  })
  source!: PurchaseSource;

  @Column({ type: 'varchar', length: 300, nullable: true })
  note!: string | null;

  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdBy!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  creator?: User;
}

/** One thing bought: becomes a batch, a purchase movement and a new average cost. */
@Entity('purchase_lines')
@Index(['purchaseId'])
@Index(['ingredientId', 'createdAt'])
@Check(
  'CHK_purchase_lines_numbers',
  '"qty" > 0 AND "qty_base" > 0 AND "total_price" >= 0',
)
export class PurchaseLine extends BaseEntity {
  @Column({ type: 'uuid', name: 'purchase_id' })
  purchaseId!: string;

  @ManyToOne(() => Purchase, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'purchase_id' })
  purchase?: Purchase;

  @Column({ type: 'uuid', name: 'ingredient_id' })
  ingredientId!: string;

  @ManyToOne(() => KitchenIngredient, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'ingredient_id' })
  ingredient?: KitchenIngredient;

  @Column({ ...numeric(12, 3) })
  qty!: number;

  @Column({ type: 'varchar', length: 20 })
  unit!: string;

  @Column({ ...numeric(14, 3), name: 'qty_base' })
  qtyBase!: number;

  /** Rupees for this line. */
  @Column({ type: 'int', name: 'total_price' })
  totalPrice!: number;

  /** Rupees per base unit (total ÷ quantity). */
  @Column({ ...numeric(12, 4), name: 'unit_cost' })
  unitCost!: number;

  @Column({ type: 'date', name: 'expires_on', nullable: true })
  expiresOn!: string | null;

  @Column({ type: 'uuid', name: 'batch_id', nullable: true })
  batchId!: string | null;

  @ManyToOne(() => StockBatch, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'batch_id' })
  batch?: StockBatch;
}
