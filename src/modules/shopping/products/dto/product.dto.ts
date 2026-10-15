import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
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
import { Trim } from '../../../../common/validation/transforms';
import { HEX_COLOR } from '../../common/contrast';
import { PaginationQueryDto } from '../../../../common/pagination/pagination';
import { PRODUCT_STATUSES, ProductStatus } from '../entities/product.entity';

export const MAX_IMAGES = 8;
export const MAX_VARIANTS = 100;

export class ProductImageDto {
  @ApiProperty({
    description: 'secure_url from an upload signed for purpose product_image.',
  })
  @IsString()
  @MaxLength(500)
  url!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(255)
  publicId!: string;
}

export class ProductVariantDto {
  @ApiPropertyOptional({
    description: 'Existing variant id (PATCH only). Omit to add a variant.',
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiPropertyOptional({
    example: 'M',
    nullable: true,
    description: 'e.g. size',
  })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 40)
  option1?: string | null;

  @ApiPropertyOptional({
    example: 'Maroon',
    nullable: true,
    description: 'e.g. colour',
  })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 40)
  option2?: string | null;

  @ApiPropertyOptional({ example: '#7F1D1D', nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @Matches(HEX_COLOR, { message: 'colorHex must be #RRGGBB' })
  colorHex?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(64)
  sku?: string | null;

  @ApiPropertyOptional({
    default: 0,
    description: 'Rupees added to the product price for this variant.',
  })
  @IsOptional()
  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  priceDelta?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  stock?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

const PARTNER_STATUSES = ['draft', 'active', 'archived'] as const;

export class CreateProductDto {
  @ApiProperty({ example: 'Embroidered lawn kurta' })
  @Trim()
  @IsString()
  @Length(2, 140)
  name!: string;

  @ApiProperty({ example: 'Three-piece lawn with chikankari neckline.' })
  @Trim()
  @IsString()
  @MaxLength(5000)
  description!: string;

  @ApiProperty()
  @IsUUID()
  categoryId!: string;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsUUID()
  collectionId?: string | null;

  @ApiProperty({ example: 4500, description: 'Rupees (integer).' })
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  basePrice!: number;

  @ApiPropertyOptional({
    example: 3900,
    nullable: true,
    description: 'Must be lower than basePrice.',
  })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  salePrice?: number | null;

  @ApiPropertyOptional({ type: [String], example: ['lawn', 'eid'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(1, 30, { each: true })
  tags?: string[];

  @ApiPropertyOptional({
    type: [ProductImageDto],
    description: 'Up to 8; the first is the cover. At least 1 to publish.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_IMAGES)
  @ValidateNested({ each: true })
  @Type(() => ProductImageDto)
  images?: ProductImageDto[];

  @ApiPropertyOptional({
    type: [ProductVariantDto],
    description: 'Omit for a single default variant.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_VARIANTS)
  @ValidateNested({ each: true })
  @Type(() => ProductVariantDto)
  variants?: ProductVariantDto[];

  @ApiPropertyOptional({ enum: ['draft', 'active'], default: 'draft' })
  @IsOptional()
  @IsIn(['draft', 'active'])
  status?: 'draft' | 'active';
}

export class UpdateProductDto {
  @IsOptional()
  @Trim()
  @IsString()
  @Length(2, 140)
  name?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsUUID()
  collectionId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  basePrice?: number;

  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  salePrice?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(1, 30, { each: true })
  tags?: string[];

  @ApiPropertyOptional({
    type: [ProductImageDto],
    description: 'Replaces the whole image list.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_IMAGES)
  @ValidateNested({ each: true })
  @Type(() => ProductImageDto)
  images?: ProductImageDto[];

  @ApiPropertyOptional({
    type: [ProductVariantDto],
    description:
      'The full desired set: with id = update, without = add, missing = deactivated.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_VARIANTS)
  @ValidateNested({ each: true })
  @Type(() => ProductVariantDto)
  variants?: ProductVariantDto[];

  @ApiPropertyOptional({ enum: PARTNER_STATUSES })
  @IsOptional()
  @IsIn([...PARTNER_STATUSES])
  status?: (typeof PARTNER_STATUSES)[number];
}

export class PartnerProductQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PRODUCT_STATUSES })
  @IsOptional()
  @IsIn([...PRODUCT_STATUSES])
  status?: ProductStatus;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsUUID()
  collectionId?: string;

  @ApiPropertyOptional({
    description: 'Only products with an active variant at ≤ 3 in stock.',
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  lowStock?: 'true' | 'false';
}
