import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { ReturnRequest } from './return-request.entity';
import { StoreOrderItem } from '../../orders/entities/store-order-item.entity';

@Entity('return_request_items')
@Index(['returnRequestId', 'storeOrderItemId'], { unique: true })
@Check('CHK_return_request_items_quantity', '"quantity" > 0')
export class ReturnRequestItem extends BaseEntity {
  @Column({ type: 'uuid', name: 'return_request_id' })
  returnRequestId!: string;

  @ManyToOne(() => ReturnRequest, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'return_request_id' })
  returnRequest?: ReturnRequest;

  @Index()
  @Column({ type: 'uuid', name: 'store_order_item_id' })
  storeOrderItemId!: string;

  @ManyToOne(() => StoreOrderItem)
  @JoinColumn({ name: 'store_order_item_id' })
  storeOrderItem?: StoreOrderItem;

  @Column({ type: 'int' })
  quantity!: number;

  /** Set when received: did this line go back into stock? */
  @Column({ type: 'boolean', nullable: true })
  restocked!: boolean | null;
}
