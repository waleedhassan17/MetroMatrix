import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { Store } from './store.entity';

/** A store's own grouping of products ("Eid edit", "Winter shawls"). */
@Entity('store_collections')
@Index(['storeId', 'slug'], { unique: true })
@Index(['storeId', 'sort'])
export class StoreCollection extends BaseEntity {
  @Column({ type: 'uuid', name: 'store_id' })
  storeId!: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'store_id' })
  store?: Store;

  @Column({ type: 'varchar', length: 60 })
  name!: string;

  @Column({ type: 'citext' })
  slug!: string;

  @Column({ type: 'int', default: 0 })
  sort!: number;
}
