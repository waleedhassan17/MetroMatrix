import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { Appointment } from '../../appointments/entities/appointment.entity';
import { Doctor } from '../../doctors/entities/doctor.entity';

export interface NoteFile {
  url: string;
  publicId: string;
  mime: string | null;
}

/** The doctor's private notes on a visit (never shown to the patient). Files persist. */
@Entity('medical_notes')
@Index(['appointmentId'], { unique: true })
@Index(['doctorId'])
export class MedicalNote extends BaseEntity {
  @Column({ type: 'uuid', name: 'appointment_id' })
  appointmentId!: string;

  @ManyToOne(() => Appointment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'appointment_id' })
  appointment?: Appointment;

  @Column({ type: 'uuid', name: 'doctor_id' })
  doctorId!: string;

  @ManyToOne(() => Doctor, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'doctor_id' })
  doctor?: Doctor;

  @Column({ type: 'text' })
  text!: string;

  @Column({ type: 'jsonb' })
  files!: NoteFile[];
}
