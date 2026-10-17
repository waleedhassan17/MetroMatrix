import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { PLAN_KEYS } from '../../../plans/plan-config';

class LimitOverridesDto {
  @IsOptional() @IsInt() @Min(0) @Max(1) brands?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1) branches?: number;
  @IsOptional() @IsInt() @Min(0) @Max(500) riders?: number;
  @IsOptional() @IsInt() @Min(0) @Max(10000) menu_items?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) promotions_active?: number;
}

class EntitlementOverridesDto {
  @IsOptional() @IsBoolean() riders?: boolean;
  @IsOptional() @IsBoolean() promotions?: boolean;
  @IsOptional() @IsBoolean() insights?: boolean;
  @IsOptional() @IsBoolean() preorders?: boolean;
}

class PlanOverridesDto {
  @ApiPropertyOptional({ example: { riders: 1 } })
  @IsOptional()
  @ValidateNested()
  @Type(() => LimitOverridesDto)
  limits?: LimitOverridesDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => EntitlementOverridesDto)
  entitlements?: EntitlementOverridesDto;
}

export class AdminPlanDto {
  @ApiPropertyOptional({ enum: PLAN_KEYS })
  @IsOptional()
  @IsIn(PLAN_KEYS)
  planKey?: string;

  /** Replaces the vendor's overrides; null clears them. Brands/branches can't go above 1 at launch. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => PlanOverridesDto)
  overrides?: PlanOverridesDto | null;
}
