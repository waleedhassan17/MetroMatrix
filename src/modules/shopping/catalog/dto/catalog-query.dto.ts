import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Trim } from '../../../../common/validation/transforms';
import { PaginationQueryDto } from '../../../../common/pagination/pagination';

export const PRODUCT_SORTS = [
  'relevance',
  'newest',
  'price_asc',
  'price_desc',
  'rating',
  'popular',
] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

const BOOL = ['true', 'false'] as const;

export class CatalogProductQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Search: words, "quoted phrases", -exclusions; typos tolerated.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsUUID()
  storeId?: string;

  @ApiPropertyOptional({
    description: 'A root category matches its whole subtree.',
  })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  collectionId?: string;

  @ApiPropertyOptional({
    description: 'On the effective price (sale price when on sale).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPrice?: number;

  @IsOptional()
  @IsIn(BOOL)
  inStock?: (typeof BOOL)[number];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(5)
  minRating?: number;

  @IsOptional()
  @IsIn(BOOL)
  onSale?: (typeof BOOL)[number];

  @ApiPropertyOptional({ enum: PRODUCT_SORTS, default: 'relevance' })
  @IsOptional()
  @IsIn(PRODUCT_SORTS)
  sort?: ProductSort;
}

export class CatalogStoreQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({
    description: 'Stores selling in this category (subtree).',
  })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Stores delivering to this city.' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(60)
  city?: string;

  @IsOptional()
  @IsIn(BOOL)
  featured?: (typeof BOOL)[number];
}

export class SuggestQueryDto {
  @Trim()
  @IsString()
  @Length(1, 100)
  q!: string;
}
