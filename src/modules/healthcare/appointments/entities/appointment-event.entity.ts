import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { Appointment } from './appointment.entity';
import { APPOINTMENT_ACTORS, AppointmentActor } from '../appointment-status';

export const APPOINTMENT_EVENT_KINDS = ['status', 'payment', 'note'] as const;
export type AppointmentEventKind = (typeof APPOINTMENT_EVENT_KINDS)[number];

/** Append-only timeline; `at` is clock_timestamp() so same-transaction events keep their order. */
@Entity('appointment_events')
@Index(['appointmentId', 'at'])
export class AppointmentEvent extends BaseEntity {
  @Column({ type: 'uuid', name: 'appointment_id' })
  appointmentId!: string;

  @ManyToOne(() => Appointment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'appointment_id' })
  appointment?: Appointment;

  @Column({
    type: 'enum',
    enum: APPOINTMENT_EVENT_KINDS,
    enumName: 'appointment_event_kind',
  })
  kind!: AppointmentEventKind;

  @Column({ type: 'varchar', length: 30, name: 'from_state', nullable: true })
  from!: string | null;

  @Column({ type: 'varchar', length: 30, name: 'to_state', nullable: true })
  to!: string | null;

  @Column({ type: 'uuid', name: 'actor_user_id', nullable: true })
  actorUserId!: string | null;

  @Column({
    type: 'enum',
    enum: APPOINTMENT_ACTORS,
    enumName: 'appointment_actor',
    name: 'actor_role',
  })
  actorRole!: AppointmentActor;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ type: 'timestamptz', default: () => 'clock_timestamp()' })
  at!: Date;
}
