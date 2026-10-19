import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Trim } from '../../../common/validation/transforms';
import { PaginationQueryDto } from '../../../common/pagination/pagination';
import { ACTIVITIES, GOALS, SEXES } from '../entities/nutrition-profile.entity';

export class FoodsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'English, Urdu or a canonical name.' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(80)
  q?: string;
}

export class MapIngredientDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'null clears the mapping.',
  })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsUUID()
  nutritionFoodId?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Grams per piece, for ingredients counted in pieces.',
  })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5000)
  pieceGrams?: number | null;
}

export class HideNutritionDto {
  @IsBoolean() hidden!: boolean;
}

/** PUT /food/me/nutrition/profile — the details for Mifflin-St Jeor, or a target of your own. */
export class NutritionProfileDto {
  @ApiProperty({ enum: GOALS })
  @IsIn(GOALS)
  goal!: (typeof GOALS)[number];

  @ApiPropertyOptional({ enum: SEXES })
  @IsOptional()
  @IsIn(SEXES)
  sex?: (typeof SEXES)[number];

  @IsOptional() @Type(() => Number) @IsInt() @Min(13) @Max(100) age?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(100)
  @Max(250)
  heightCm?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(25)
  @Max(300)
  weightKg?: number;

  @ApiPropertyOptional({ enum: ACTIVITIES })
  @IsOptional()
  @IsIn(ACTIVITIES)
  activity?: (typeof ACTIVITIES)[number];

  @ApiPropertyOptional({
    minimum: 800,
    maximum: 6000,
    description: 'Your own daily target; used instead of the formula.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(800)
  @Max(6000)
  manualTargetKcal?: number;
}

export class SummaryQueryDto {
  @ApiPropertyOptional({ enum: ['7d', '30d'], default: '7d' })
  @IsOptional()
  @IsIn(['7d', '30d'])
  range: '7d' | '30d' = '7d';
}
