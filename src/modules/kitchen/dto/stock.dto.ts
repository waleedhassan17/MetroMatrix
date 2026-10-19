import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Trim } from '../../../common/validation/transforms';
import { PaginationQueryDto } from '../../../common/pagination/pagination';
import {
  INGREDIENT_CATEGORIES,
  IngredientCategory,
} from '../entities/kitchen-ingredient.entity';
import { BASE_UNITS, BaseUnit } from '../stock/units';

export class CustomUnitDto {
  @ApiProperty({ example: 'tray' })
  @Trim()
  @Matches(/^[a-z][a-z ]{0,19}$/, {
    message: 'name: lowercase letters, up to 20',
  })
  name!: string;

  @ApiProperty({
    example: 30,
    description: 'How many base units one of it is (1 tray = 30 eggs).',
  })
  @IsNumber()
  @Min(0.001)
  @Max(1_000_000)
  factor!: number;
}

export class QtyDto {
  @ApiProperty({ example: 5 }) @IsNumber() @Min(0) @Max(1_000_000) qty!: number;
  @ApiProperty({ example: 'kg' })
  @Trim()
  @IsString()
  @Length(1, 20)
  unit!: string;
}

export class OpeningStockDto extends QtyDto {
  @ApiPropertyOptional({
    example: 1200,
    description: 'Rupees for this quantity; sets the starting average cost.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10_000_000)
  totalCost?: number;

  @ApiPropertyOptional({ example: '2026-10-25' })
  @IsOptional()
  @IsISO8601({ strict: true })
  expiresOn?: string;
}

export class IngredientDto {
  @ApiProperty({ example: 'Tomato' })
  @Trim()
  @IsString()
  @Length(2, 80)
  name!: string;

  @ApiPropertyOptional({ example: 'ٹماٹر' })
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 80)
  nameUr?: string;

  @ApiProperty({ enum: INGREDIENT_CATEGORIES })
  @IsIn(INGREDIENT_CATEGORIES)
  category!: IngredientCategory;

  @ApiProperty({
    enum: BASE_UNITS,
    description: 'g, ml or piece — what stock and recipes are counted in.',
  })
  @IsIn(BASE_UNITS)
  baseUnit!: BaseUnit;

  @ApiPropertyOptional({ type: [CustomUnitDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => CustomUnitDto)
  customUnits?: CustomUnitDto[];

  @ApiPropertyOptional({
    type: QtyDto,
    nullable: true,
    description: 'Reorder point.',
  })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @ValidateNested()
  @Type(() => QtyDto)
  parLevel?: QtyDto | null;

  @ApiPropertyOptional({
    type: OpeningStockDto,
    description: 'What is on the shelf now.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => OpeningStockDto)
  openingStock?: OpeningStockDto;
}

export class UpdateIngredientDto {
  @IsOptional() @Trim() @IsString() @Length(2, 80) name?: string;

  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 80)
  nameUr?: string | null;

  @IsOptional() @IsIn(INGREDIENT_CATEGORIES) category?: IngredientCategory;

  @ApiPropertyOptional({ description: 'Only before any stock has moved.' })
  @IsOptional()
  @IsIn(BASE_UNITS)
  baseUnit?: BaseUnit;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => CustomUnitDto)
  customUnits?: CustomUnitDto[];

  @ApiPropertyOptional({ type: QtyDto, nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @ValidateNested()
  @Type(() => QtyDto)
  parLevel?: QtyDto | null;

  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class IngredientsQueryDto extends PaginationQueryDto {
  @IsOptional() @Trim() @IsString() @MaxLength(80) q?: string;
  @IsOptional() @IsIn(INGREDIENT_CATEGORIES) category?: IngredientCategory;

  @ApiPropertyOptional({ enum: ['true', 'false', 'all'], default: 'true' })
  @IsOptional()
  @IsIn(['true', 'false', 'all'])
  active?: 'true' | 'false' | 'all';
}

export class StockQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: ['all', 'expiring', 'below_par', 'negative'],
    default: 'all',
  })
  @IsOptional()
  @IsIn(['all', 'expiring', 'below_par', 'negative'])
  filter?: 'all' | 'expiring' | 'below_par' | 'negative';

  @IsOptional() @Trim() @IsString() @MaxLength(80) q?: string;
  @IsOptional() @IsIn(INGREDIENT_CATEGORIES) category?: IngredientCategory;
}

export class CountLineDto extends QtyDto {
  @IsUUID() ingredientId!: string;
}

export class StockCountDto {
  @ApiProperty({
    type: [CountLineDto],
    description: 'What you counted; each line sets on-hand to that amount.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => CountLineDto)
  lines!: CountLineDto[];

  @IsOptional() @Trim() @IsString() @MaxLength(300) note?: string;
}

export class RecipeLineDto extends QtyDto {
  @IsUUID() ingredientId!: string;

  @ApiPropertyOptional({ description: 'Used only when this add-on is chosen.' })
  @IsOptional()
  @IsUUID()
  optionId?: string;

  @ApiPropertyOptional({
    description:
      'Boxes, bags: costed and deducted, never what makes it sold out.',
  })
  @IsOptional()
  @IsBoolean()
  isPackaging?: boolean;
}

export class RecipeDto {
  @ApiPropertyOptional({
    default: 1,
    description: 'The lines make this many servings.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  yieldServings?: number;

  @IsOptional() @Trim() @IsString() @MaxLength(2000) notes?: string;

  @ApiProperty({ type: [RecipeLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => RecipeLineDto)
  lines!: RecipeLineDto[];
}

export class VariantQueryDto {
  @ApiPropertyOptional({
    description: 'A size of the dish; without it, the dish’s own card.',
  })
  @IsOptional()
  @IsUUID()
  variantId?: string;
}

/** PUT /food/vendor/kitchen/items/:itemId/signature */
export class SignatureDto {
  @IsBoolean() isSignature!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    example: 'Ammi Jaan',
    description: 'Whose recipe it is (default: the kitchen’s cook).',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Trim()
  @IsString()
  @Length(2, 120)
  by?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: '2019-03-01',
    description: 'Since when (default: today).',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsISO8601({ strict: true })
  since?: string | null;
}
