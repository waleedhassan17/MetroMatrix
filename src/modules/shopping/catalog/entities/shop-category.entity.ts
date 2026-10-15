import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';

/**
 * The platform's product taxonomy (admin-managed, seeded by migration).
 * Two levels: roots ("Women") and their children ("Kurtas & tunics").
 * Products hang off any level; filtering by a root matches its subtree.
 */
@Entity('shop_categories')
@Index(['parentId', 'sort'])
export class ShopCategory extends BaseEntity {
  @Column({ type: 'uuid', name: 'parent_id', nullable: true })
  parentId!: string | null;

  @ManyToOne(() => ShopCategory, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'parent_id' })
  parent?: ShopCategory | null;

  @Column({ type: 'varchar', length: 60 })
  name!: string;

  @Index({ unique: true })
  @Column({ type: 'citext' })
  slug!: string;

  /** An icon key the app maps to its icon set (e.g. `women`, `kitchen`). */
  @Column({ type: 'varchar', length: 40, nullable: true })
  icon!: string | null;

  @Column({ type: 'int', default: 0 })
  sort!: number;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive!: boolean;
}
