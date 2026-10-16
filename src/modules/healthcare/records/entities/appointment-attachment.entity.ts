import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { Appointment } from '../../appointments/entities/appointment.entity';
import { HealthRecord } from './health-record.entity';

/** A record the patient shared with one appointment's doctor. Detaching revokes access. */
@Entity('appointment_attachments')
@Index(['appointmentId', 'recordId'], { unique: true })
@Index(['recordId'])
export class AppointmentAttachment extends BaseEntity {
  @Column({ type: 'uuid', name: 'appointment_id' })
  appointmentId!: string;

  @ManyToOne(() => Appointment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'appointment_id' })
  appointment?: Appointment;

  @Column({ type: 'uuid', name: 'record_id' })
  recordId!: string;

  @ManyToOne(() => HealthRecord, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'record_id' })
  record?: HealthRecord;
}
