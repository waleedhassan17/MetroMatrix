import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { Condition } from './condition.entity';
import { Specialty } from './specialty.entity';

/** Which specialties treat a condition; `rank` 1 = the first doctor to see. */
@Entity('condition_specialties')
@Index(['conditionId', 'specialtyId'], { unique: true })
@Index(['specialtyId'])
export class ConditionSpecialty extends BaseEntity {
  @Column({ type: 'uuid', name: 'condition_id' })
  conditionId!: string;

  @ManyToOne(() => Condition, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'condition_id' })
  condition?: Condition;

  @Column({ type: 'uuid', name: 'specialty_id' })
  specialtyId!: string;

  @ManyToOne(() => Specialty, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'specialty_id' })
  specialty?: Specialty;

  @Column({ type: 'smallint', default: 1 })
  rank!: number;
}
