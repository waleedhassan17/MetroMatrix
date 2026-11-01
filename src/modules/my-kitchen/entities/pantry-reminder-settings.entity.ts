import {
  Check,
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/** When a person hears about what expires: none of a row means the defaults (on, 09:00, 2 days before). */
@Entity('pantry_reminder_settings')
@Check('CHK_pantry_reminder_hour', '"hour" BETWEEN 6 AND 22')
@Check('CHK_pantry_reminder_days', '"days_before" BETWEEN 0 AND 3')
export class PantryReminderSettings {
  @PrimaryColumn({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  /** Pakistan time, on the hour. */
  @Column({ type: 'smallint', default: 9 })
  hour!: number;

  /** The "use soon" reminder this many days before (0: only on the day). */
  @Column({ type: 'smallint', name: 'days_before', default: 2 })
  daysBefore!: number;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
