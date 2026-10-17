import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Trim } from '../../../../common/validation/transforms';
import { PaginationQueryDto } from '../../../../common/pagination/pagination';

export class PointQueryDto {
  @ApiProperty({ example: 31.5204 })
  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @ApiProperty({ example: 74.3587 })
  @Type(() => Number)
  @IsLongitude()
  lng!: number;
}

export class OptionalPointQueryDto {
  @ApiPropertyOptional({ example: 31.5204 })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @ApiPropertyOptional({ example: 74.3587 })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;
}

export const VENDOR_SORTS = [
  'recommended',
  'distance',
  'rating',
  'delivery_time',
  'delivery_fee',
] as const;
export type VendorSort = (typeof VENDOR_SORTS)[number];

const bool = ['true', 'false'] as const;

export class VendorQueryDto extends PaginationQueryDto {
  @ApiProperty({ example: 31.5204 })
  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @ApiProperty({ example: 74.3587 })
  @Type(() => Number)
  @IsLongitude()
  lng!: number;

  @ApiPropertyOptional({ description: 'Vendor name, cuisine or dish.' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(80)
  q?: string;

  @ApiPropertyOptional({ description: 'Cuisine slug (or id).' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  cuisine?: string;

  @ApiPropertyOptional({ enum: VENDOR_SORTS, default: 'recommended' })
  @IsOptional()
  @IsIn(VENDOR_SORTS)
  sort?: VendorSort;

  @ApiPropertyOptional({
    enum: bool,
    description: 'No delivery fee to this point (or a free-delivery deal).',
  })
  @IsOptional()
  @IsIn(bool)
  freeDelivery?: 'true' | 'false';

  @ApiPropertyOptional({ enum: bool, description: 'Has a live deal.' })
  @IsOptional()
  @IsIn(bool)
  offers?: 'true' | 'false';

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(5)
  minRating?: number;

  @ApiPropertyOptional({
    enum: bool,
    description:
      'Pickup: vendors you can collect from nearby, whatever their delivery zone.',
  })
  @IsOptional()
  @IsIn(bool)
  pickup?: 'true' | 'false';

  @ApiPropertyOptional({ enum: bool })
  @IsOptional()
  @IsIn(bool)
  homeKitchen?: 'true' | 'false';

  @ApiPropertyOptional({ enum: bool })
  @IsOptional()
  @IsIn(bool)
  openNow?: 'true' | 'false';

  @ApiPropertyOptional({ minimum: 1, maximum: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3)
  priceLevel?: number;
}

export class SearchQueryDto extends PointQueryDto {
  @ApiProperty({ example: 'karahi' })
  @Trim()
  @IsString()
  @MaxLength(80)
  q!: string;
}
