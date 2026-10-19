import { Check, Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';

export const CALENDAR_KINDS = [
  'ramadan',
  'eid',
  'public_holiday',
  'other',
] as const;
export type CalendarKind = (typeof CALENDAR_KINDS)[number];

/**
 * Staff-managed days that change demand and hours: Ramadan (sehri/iftar
 * windows, P7), Eid, public holidays. `city` null = everywhere. Used by
 * the forecast's event factor and by Ramadan mode.
 */
@Entity('calendar_events')
@Index(['startsOn', 'endsOn'])
@Check('CHK_calendar_events_dates', '"ends_on" >= "starts_on"')
export class CalendarEvent extends BaseEntity {
  @Column({ type: 'enum', enum: CALENDAR_KINDS, enumName: 'calendar_kind' })
  kind!: CalendarKind;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'date', name: 'starts_on' })
  startsOn!: string;

  @Column({ type: 'date', name: 'ends_on' })
  endsOn!: string;

  @Column({ type: 'citext', nullable: true })
  city!: string | null;
}
