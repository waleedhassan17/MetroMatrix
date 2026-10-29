import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * One row per setting that was ever changed; absent keys take their default
 * from settings-schema.ts. `updated_by` is shown in the console next to the
 * value (the audit row written in the same transaction has the full story).
 */
@Entity('platform_settings')
export class PlatformSetting {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  key!: string;

  // `any`: TypeORM cannot type an `unknown` jsonb value on insert.
  @Column({ type: 'jsonb' })
  value!: any;

  @Column({ type: 'uuid', name: 'updated_by', nullable: true })
  updatedBy!: string | null;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
