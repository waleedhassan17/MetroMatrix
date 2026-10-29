import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Response shapes for admin-food-plan.controller.ts (Swagger only), checked
 * against real responses from the e2e suites.
 */

export class AdminFoodPlanPatchViewLimits {
  @ApiProperty({ type: 'integer' })
  brands!: number;
  @ApiProperty({ type: 'integer' })
  branches!: number;
  @ApiProperty({ type: 'integer' })
  riders!: number;
  @ApiProperty({ type: 'integer' })
  menu_items!: number;
  @ApiProperty({ type: 'integer' })
  promotions_active!: number;
  @ApiProperty({ type: 'integer' })
  ai_actions_month!: number;
  @ApiProperty({ type: 'integer' })
  voice_minutes_month!: number;
}

export class AdminFoodPlanPatchViewUsage {
  @ApiProperty({ type: 'integer' })
  brands!: number;
  @ApiProperty({ type: 'integer' })
  branches!: number;
  @ApiProperty({ type: 'integer' })
  riders!: number;
  @ApiProperty({ type: 'integer' })
  menu_items!: number;
  @ApiProperty({ type: 'integer' })
  promotions_active!: number;
  @ApiProperty({ type: 'integer' })
  ai_actions_month!: number;
  @ApiProperty({ type: 'integer' })
  voice_minutes_month!: number;
}

export class AdminFoodPlanPatchViewEntitlements {
  @ApiProperty({ type: Boolean })
  riders!: boolean;
  @ApiProperty({ type: Boolean })
  promotions!: boolean;
  @ApiProperty({ type: Boolean })
  insights!: boolean;
  @ApiProperty({ type: Boolean })
  preorders!: boolean;
}

export class AdminFoodPlanPatchViewOverridesLimits {
  @ApiPropertyOptional({ type: 'integer' })
  ai_actions_month?: number;
  @ApiPropertyOptional({ type: 'integer' })
  riders?: number;
  @ApiPropertyOptional({ type: 'integer' })
  promotions_active?: number;
  @ApiPropertyOptional({ type: 'integer' })
  voice_minutes_month?: number;
  @ApiPropertyOptional({ type: 'integer' })
  menu_items?: number;
}

export class AdminFoodPlanPatchViewOverridesEntitlements {
  @ApiPropertyOptional({ type: Boolean })
  insights?: boolean;
  @ApiPropertyOptional({ type: Boolean })
  riders?: boolean;
  @ApiPropertyOptional({ type: Boolean })
  preorders?: boolean;
}

export class AdminFoodPlanPatchViewOverrides {
  @ApiPropertyOptional({ type: () => AdminFoodPlanPatchViewOverridesLimits })
  limits?: AdminFoodPlanPatchViewOverridesLimits;
  @ApiPropertyOptional({
    type: () => AdminFoodPlanPatchViewOverridesEntitlements,
  })
  entitlements?: AdminFoodPlanPatchViewOverridesEntitlements;
}

export class AdminFoodPlanPatchView {
  @ApiProperty({ type: String })
  planKey!: string;
  @ApiProperty({ type: String })
  label!: string;
  @ApiProperty({ type: 'integer' })
  priceMinorUnits!: number;
  @ApiProperty({ type: String })
  currency!: string;
  @ApiProperty({ type: () => AdminFoodPlanPatchViewLimits })
  limits!: AdminFoodPlanPatchViewLimits;
  @ApiProperty({ type: () => AdminFoodPlanPatchViewUsage })
  usage!: AdminFoodPlanPatchViewUsage;
  @ApiProperty({ type: () => AdminFoodPlanPatchViewEntitlements })
  entitlements!: AdminFoodPlanPatchViewEntitlements;
  @ApiProperty({ type: String, format: 'date-time' })
  startedAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  expiresAt!: string | null;
  @ApiProperty({ type: () => AdminFoodPlanPatchViewOverrides })
  overrides!: AdminFoodPlanPatchViewOverrides;
}
