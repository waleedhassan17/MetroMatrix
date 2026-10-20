import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Trim } from '../../../common/validation/transforms';
import { PaginationQueryDto } from '../../../common/pagination/pagination';
import { NUTRITION_SOURCES } from '../entities/nutrition-food.entity';

export class AdminFoodsQueryDto extends PaginationQueryDto {
  @IsOptional() @Trim() @IsString() @MaxLength(80) q?: string;
  @ApiPropertyOptional({ enum: NUTRITION_SOURCES })
  @IsOptional()
  @IsIn(NUTRITION_SOURCES)
  source?: (typeof NUTRITION_SOURCES)[number];
  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  active?: 'true' | 'false';
}

class FoodValues {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Trim()
  @IsString()
  @Length(1, 120)
  nameUr?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  @Min(1)
  @Max(5000)
  pieceGrams?: number | null;
  @ApiPropertyOptional({
    type: [String],
    description: 'Canonical ingredient names it stands for.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(2, 80, { each: true })
  canonicals?: string[];
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Trim()
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

/** Values per 100 g. */
export class NutritionFoodDto extends FoodValues {
  @ApiPropertyOptional({ description: 'Default: from the name.' })
  @IsOptional()
  @Matches(/^[a-z0-9-]{2,64}$/)
  key?: string;
  @Trim() @IsString() @Length(2, 200) name!: string;
  @Trim() @IsString() @Length(2, 80) foodGroup!: string;
  @ApiProperty({ example: 120 }) @IsNumber() @Min(0) @Max(950) kcal!: number;
  @IsNumber() @Min(0) @Max(100) proteinG!: number;
  @IsNumber() @Min(0) @Max(100) carbsG!: number;
  @IsNumber() @Min(0) @Max(100) fatG!: number;
  @IsNumber() @Min(0) @Max(100) fibreG!: number;
  @IsNumber() @Min(0) @Max(100000) sodiumMg!: number;
}

export class UpdateNutritionFoodDto extends FoodValues {
  @IsOptional() @Trim() @IsString() @Length(2, 200) name?: string;
  @IsOptional() @Trim() @IsString() @Length(2, 80) foodGroup?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(950) kcal?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) proteinG?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) carbsG?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) fatG?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) fibreG?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100000) sodiumMg?: number;
}

export class FoodsCsvDto {
  @ApiProperty({
    description:
      'key,name,name_ur,food_group,kcal,protein_g,carbs_g,fat_g,fibre_g,sodium_mg,piece_grams (≤ 512 KB)',
  })
  @IsString()
  @MaxLength(512 * 1024)
  csv!: string;
}
