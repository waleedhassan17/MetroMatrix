import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Branch } from '../../food/vendor/entities/branch.entity';

/** An insight card the vendor put away for a day (one row per card key; a new snooze replaces it). */
@Entity('kitchen_card_snoozes')
export class KitchenCardSnooze {
  @PrimaryColumn({ type: 'uuid', name: 'branch_id' })
  branchId!: string;

  @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'branch_id' })
  branch?: Branch;

  @PrimaryColumn({ type: 'varchar', length: 200, name: 'card_key' })
  cardKey!: string;

  @Column({ type: 'timestamptz', name: 'snoozed_until' })
  snoozedUntil!: Date;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
