import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { PracticeLocation } from './practice-location.entity';

/** One range of an override, in the location's wall-clock time ("24:00" ends the day). */
export interface OverrideRange {
  start: string;
  end: string;
}

/**
 * Different hours at a location on one date: extra hours, shorter hours, or
 * closed. While it exists, the date's weekly hours don't apply there.
 */
@Entity('schedule_overrides')
@Index('UQ_schedule_overrides_location_date', ['locationId', 'date'], {
  unique: true,
})
export class ScheduleOverride extends BaseEntity {
  @Column({ type: 'uuid', name: 'location_id' })
  locationId!: string;

  @ManyToOne(() => PracticeLocation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'location_id' })
  location?: PracticeLocation;

  /** The location's local date. */
  @Column({ type: 'date' })
  date!: string;

  @Column({ type: 'boolean', default: false })
  closed!: boolean;

  /** Empty when closed. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  ranges!: OverrideRange[];

  /** "Late clinic for Eid" — shown to the doctor only. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  note!: string | null;
}
