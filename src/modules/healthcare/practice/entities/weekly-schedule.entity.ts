import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { PracticeLocation } from './practice-location.entity';

/**
 * One weekly range at a location, in the location's wall-clock time
 * (weekday 0 = Sunday). Overlaps across all of a doctor's locations are
 * refused by the service (SCHEDULE_OVERLAP).
 */
@Entity('weekly_schedules')
@Index(['locationId', 'weekday'])
@Check(
  'CHK_weekly_schedules_range',
  '"weekday" BETWEEN 0 AND 6 AND "end_time" > "start_time"',
)
export class WeeklySchedule extends BaseEntity {
  @Column({ type: 'uuid', name: 'location_id' })
  locationId!: string;

  @ManyToOne(() => PracticeLocation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'location_id' })
  location?: PracticeLocation;

  @Column({ type: 'smallint' })
  weekday!: number;

  @Column({ type: 'time', name: 'start_time' })
  startTime!: string;

  @Column({ type: 'time', name: 'end_time' })
  endTime!: string;
}
