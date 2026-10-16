import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { Doctor } from '../../doctors/entities/doctor.entity';
import { PracticeLocation } from './practice-location.entity';

/** A doctor away — everywhere (location null) or at one location. */
@Entity('time_off')
@Index(['doctorId', 'startsAt'])
@Check('CHK_time_off_range', '"ends_at" > "starts_at"')
export class TimeOff extends BaseEntity {
  @Column({ type: 'uuid', name: 'doctor_id' })
  doctorId!: string;

  @ManyToOne(() => Doctor, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'doctor_id' })
  doctor?: Doctor;

  @Column({ type: 'uuid', name: 'location_id', nullable: true })
  locationId!: string | null;

  @ManyToOne(() => PracticeLocation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'location_id' })
  location?: PracticeLocation;

  @Column({ type: 'timestamptz', name: 'starts_at' })
  startsAt!: Date;

  @Column({ type: 'timestamptz', name: 'ends_at' })
  endsAt!: Date;

  @Column({ type: 'varchar', length: 200, nullable: true })
  reason!: string | null;
}
