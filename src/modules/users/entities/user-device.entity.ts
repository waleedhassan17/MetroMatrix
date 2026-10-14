import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/base/base.entity';
import { User } from './user.entity';

export const DEVICE_PLATFORMS = ['ios', 'android'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

/**
 * An Expo push token. A token identifies one app install, so it belongs to
 * whichever account last registered it on that device.
 */
@Entity('user_devices')
export class UserDevice extends BaseEntity {
  @Index()
  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255, name: 'expo_push_token' })
  expoPushToken!: string;

  @Column({ type: 'enum', enum: DEVICE_PLATFORMS, enumName: 'device_platform' })
  platform!: DevicePlatform;

  @Column({ type: 'timestamptz', name: 'last_seen_at' })
  lastSeenAt!: Date;
}
