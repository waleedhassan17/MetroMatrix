import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';

/** Cuisine chips (Pakistani, BBQ, Biryani…). Seeded by migration; staff CRUD. */
@Entity('cuisines')
@Index(['isActive', 'sort'])
export class Cuisine extends BaseEntity {
  @Column({ type: 'varchar', length: 60 })
  name!: string;

  @Index({ unique: true })
  @Column({ type: 'citext' })
  slug!: string;

  /** An icon key the app maps to its own artwork. */
  @Column({ type: 'varchar', length: 40, nullable: true })
  icon!: string | null;

  @Column({ type: 'int', default: 0 })
  sort!: number;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive!: boolean;
}
