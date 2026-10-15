import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';

/**
 * A disease or symptom people browse by ("Acne"), with the words they
 * actually type (`aliases`: "pimples", "daane"). `is_common` ones are the
 * home-screen chips.
 */
@Entity('conditions')
@Index(['isCommon'])
export class Condition extends BaseEntity {
  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'varchar', length: 140, name: 'name_ur', nullable: true })
  nameUr!: string | null;

  @Index({ unique: true })
  @Column({ type: 'citext' })
  slug!: string;

  @Column({ type: 'text', array: true })
  aliases!: string[];

  @Column({ type: 'boolean', name: 'is_common', default: false })
  isCommon!: boolean;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive!: boolean;
}
