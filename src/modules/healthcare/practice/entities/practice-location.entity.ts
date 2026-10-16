import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { Doctor } from '../../doctors/entities/doctor.entity';

export const LOCATION_KINDS = ['clinic', 'video'] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

const coordinate = {
  to: (v?: number | null) => v,
  from: (v: string | null) => (v === null ? null : parseFloat(v)),
};

/**
 * Where a doctor sees patients: a clinic/hospital, or "Video consultation" —
 * each with its own fee, slot length, zone and hours. At most one active
 * video location per doctor (partial unique index).
 */
@Entity('practice_locations')
@Index(['doctorId', 'isActive'])
@Index(['city', 'isActive'])
@Index('UQ_practice_locations_one_video', ['doctorId'], {
  unique: true,
  where: `"kind" = 'video' AND "is_active"`,
})
@Check(
  'CHK_practice_locations_rules',
  '"fee" >= 0 AND "slot_minutes" BETWEEN 10 AND 60',
)
export class PracticeLocation extends BaseEntity {
  @Column({ type: 'uuid', name: 'doctor_id' })
  doctorId!: string;

  @ManyToOne(() => Doctor, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'doctor_id' })
  doctor?: Doctor;

  @Column({
    type: 'enum',
    enum: LOCATION_KINDS,
    enumName: 'practice_location_kind',
  })
  kind!: LocationKind;

  @Column({ type: 'varchar', length: 140 })
  name!: string;

  @Column({
    type: 'varchar',
    length: 255,
    name: 'address_line',
    nullable: true,
  })
  addressLine!: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  area!: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  city!: string | null;

  @Column({
    type: 'numeric',
    precision: 9,
    scale: 6,
    nullable: true,
    transformer: coordinate,
  })
  lat!: number | null;

  @Column({
    type: 'numeric',
    precision: 9,
    scale: 6,
    nullable: true,
    transformer: coordinate,
  })
  lng!: number | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  phone!: string | null;

  /** IANA zone the weekly hours are written in. */
  @Column({ type: 'varchar', length: 60, default: 'Asia/Karachi' })
  timezone!: string;

  /** Rupees. */
  @Column({ type: 'int' })
  fee!: number;

  @Column({ type: 'smallint', name: 'slot_minutes', default: 15 })
  slotMinutes!: number;

  /** "Ask for a token at reception." */
  @Column({ type: 'text', nullable: true })
  instructions!: string | null;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive!: boolean;

  @Column({ type: 'timestamptz', name: 'next_available_at', nullable: true })
  nextAvailableAt!: Date | null;
}
