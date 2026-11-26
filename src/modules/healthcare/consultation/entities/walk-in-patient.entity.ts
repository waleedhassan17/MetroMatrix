import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { Doctor } from '../../doctors/entities/doctor.entity';

/**
 * Someone who came to the clinic without booking in the app: the doctor adds
 * them at the desk. They have no account — no notifications, reviews or
 * records — and only that doctor sees them (as with any patient, only
 * through their visits).
 */
@Entity('walk_in_patients')
@Index(['doctorId', 'createdAt'])
export class WalkInPatient extends BaseEntity {
  @Column({ type: 'uuid', name: 'doctor_id' })
  doctorId!: string;

  @ManyToOne(() => Doctor, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'doctor_id' })
  doctor?: Doctor;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  /** +92…, so the clinic can call them. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  gender!: string | null;

  @Column({ type: 'smallint', nullable: true })
  age!: number | null;
}
