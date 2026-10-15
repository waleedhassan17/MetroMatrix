import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';

export const MEDICINE_FORMS = [
  'tablet',
  'capsule',
  'syrup',
  'injection',
  'cream',
  'drops',
  'other',
] as const;
export type MedicineForm = (typeof MEDICINE_FORMS)[number];

/**
 * Common generic medicines (seeded from seed/health/medicines.csv) that back
 * the prescription writer's autocomplete after the doctor's own favourites.
 */
@Entity('medicines')
@Index(['name', 'strength', 'form'], { unique: true })
@Index('IDX_medicines_name_trgm', { synchronize: false })
export class Medicine extends BaseEntity {
  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 40 })
  strength!: string;

  @Column({ type: 'enum', enum: MEDICINE_FORMS, enumName: 'medicine_form' })
  form!: MedicineForm;
}
