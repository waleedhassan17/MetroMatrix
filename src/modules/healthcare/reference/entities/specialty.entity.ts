import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';

/**
 * A medical specialty, named in English and Urdu ("Dermatologist" /
 * "ماہر امراض جلد"). `keywords` are lay words people search with ("skin",
 * "jild") — matched by search-as-you-type. Reference data: seeded by
 * migration, edited by admins.
 */
@Entity('specialties')
@Index(['isActive', 'sort'])
export class Specialty extends BaseEntity {
  @Column({ type: 'varchar', length: 80 })
  name!: string;

  @Column({ type: 'varchar', length: 120, name: 'name_ur' })
  nameUr!: string;

  @Index({ unique: true })
  @Column({ type: 'citext' })
  slug!: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  icon!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'text', array: true })
  keywords!: string[];

  @Column({ type: 'int', default: 0 })
  sort!: number;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive!: boolean;
}
