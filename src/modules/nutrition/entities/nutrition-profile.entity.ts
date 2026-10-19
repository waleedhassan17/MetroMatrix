import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { numeric } from '../../kitchen/common/numeric';

export const GOALS = ['maintain', 'lose', 'gain'] as const;
export const SEXES = ['male', 'female'] as const;
export const ACTIVITIES = [
  'sedentary',
  'light',
  'moderate',
  'active',
  'very_active',
] as const;
export const TARGET_METHODS = ['mifflin_st_jeor', 'manual'] as const;

/**
 * A customer's opt-in nutrition target. Theirs only: no vendor route reads
 * it, no analytics include it, and deleting it removes the row.
 */
@Entity('nutrition_profiles')
@Check(
  'CHK_nutrition_profiles_numbers',
  '("age" IS NULL OR "age" BETWEEN 13 AND 100) AND ("height_cm" IS NULL OR "height_cm" BETWEEN 100 AND 250) AND ("weight_kg" IS NULL OR "weight_kg" BETWEEN 25 AND 300) AND "target_kcal" BETWEEN 800 AND 6000',
)
export class NutritionProfile {
  @PrimaryColumn({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ type: 'enum', enum: GOALS, enumName: 'nutrition_goal' })
  goal!: (typeof GOALS)[number];

  @Column({
    type: 'enum',
    enum: SEXES,
    enumName: 'nutrition_sex',
    nullable: true,
  })
  sex!: (typeof SEXES)[number] | null;

  @Column({ type: 'smallint', nullable: true })
  age!: number | null;

  @Column({ ...numeric(5, 1), name: 'height_cm', nullable: true })
  heightCm!: number | null;

  @Column({ ...numeric(5, 1), name: 'weight_kg', nullable: true })
  weightKg!: number | null;

  @Column({
    type: 'enum',
    enum: ACTIVITIES,
    enumName: 'nutrition_activity',
    nullable: true,
  })
  activity!: (typeof ACTIVITIES)[number] | null;

  @Column({ type: 'int', name: 'target_kcal' })
  targetKcal!: number;

  @Column({
    type: 'enum',
    enum: TARGET_METHODS,
    enumName: 'nutrition_target_method',
    name: 'target_method',
  })
  targetMethod!: (typeof TARGET_METHODS)[number];

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
