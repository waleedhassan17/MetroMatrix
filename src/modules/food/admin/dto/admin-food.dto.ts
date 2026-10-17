import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Trim } from '../../../../common/validation/transforms';
import { PaginationQueryDto } from '../../../../common/pagination/pagination';
import {
  FOOD_ORDER_STATUSES,
  FoodOrderStatus,
} from '../../orders/food-order-status';
import {
  FOOD_BANNER_TARGETS,
  FoodBannerTarget,
} from '../entities/food-banner.entity';

export const FOOD_SUB_TYPES = [
  'restaurant',
  'cloud_kitchen',
  'home_kitchen',
] as const;
export const ADMIN_VENDOR_STATES = [
  'live',
  'draft',
  'paused',
  'suspended',
] as const;

export class AdminFoodVendorsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: FOOD_SUB_TYPES })
  @IsOptional()
  @IsIn(FOOD_SUB_TYPES)
  type?: (typeof FOOD_SUB_TYPES)[number];

  @ApiPropertyOptional({ enum: ADMIN_VENDOR_STATES })
  @IsOptional()
  @IsIn(ADMIN_VENDOR_STATES)
  status?: (typeof ADMIN_VENDOR_STATES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(60)
  city?: string;

  @ApiPropertyOptional({ description: 'Name, slug or owner email.' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(80)
  q?: string;
}

export class AdminFoodOrdersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'FC-7KQ2PX' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(16)
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @ApiPropertyOptional({ enum: FOOD_ORDER_STATUSES })
  @IsOptional()
  @IsIn(FOOD_ORDER_STATUSES)
  status?: FoodOrderStatus;
}

export class AdminReasonDto {
  @ApiProperty({ example: 'Repeated food-safety complaints' })
  @Trim()
  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class CuisineDto {
  @ApiProperty({ example: 'Pakistani' })
  @Trim()
  @IsString()
  @Length(2, 60)
  name!: string;

  @ApiProperty({ example: 'pakistani' })
  @Matches(/^[a-z0-9-]{2,40}$/, {
    message: 'slug is 2–40 lowercase letters, digits or dashes',
  })
  slug!: string;

  @ApiPropertyOptional({ example: 'flame' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  icon?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  sort?: number;
}

export class UpdateCuisineDto extends PartialType(CuisineDto) {
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class FoodBannerDto {
  @ApiProperty({
    description: 'secure_url of an upload signed for purpose banner.',
  })
  @IsString()
  @MaxLength(500)
  imageUrl!: string;

  @ApiProperty({ example: 'Biryani week' })
  @Trim()
  @IsString()
  @Length(2, 80)
  title!: string;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(160)
  subtitle?: string | null;

  @ApiProperty({ enum: FOOD_BANNER_TARGETS })
  @IsIn(FOOD_BANNER_TARGETS)
  targetType!: FoodBannerTarget;

  @ApiPropertyOptional({ description: 'vendor or cuisine id.' })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsUUID()
  targetId?: string | null;

  @ApiPropertyOptional({ description: 'search: what the banner searches for.' })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @Trim()
  @IsString()
  @Length(2, 80)
  targetQuery?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'null = every city.' })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(60)
  city?: string | null;

  @ApiPropertyOptional({ description: 'Defaults to now.' })
  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsISO8601()
  endsAt?: string | null;

  @IsOptional() @IsInt() @Min(0) @Max(999) sort?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateFoodBannerDto extends PartialType(FoodBannerDto) {}
