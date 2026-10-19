import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
  ValidateNested,
} from 'class-validator';
import { Trim } from '../../../../common/validation/transforms';
import { ITEM_TAGS, ItemTag } from '../entities/menu-item.entity';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CategoryDto {
  @ApiProperty({ example: 'Karahi' })
  @Trim()
  @IsString()
  @Length(1, 80)
  name!: string;

  @ApiPropertyOptional({
    example: '07:00',
    nullable: true,
    description: 'Daily window start (local).',
  })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @Matches(HHMM)
  availableFrom?: string | null;

  @ApiPropertyOptional({ example: '11:00', nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @Matches(HHMM)
  availableTo?: string | null;

  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateCategoryDto {
  @IsOptional() @Trim() @IsString() @Length(1, 80) name?: string;

  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @Matches(HHMM)
  availableFrom?: string | null;

  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @Matches(HHMM)
  availableTo?: string | null;

  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ReorderDto {
  @ApiProperty({ type: [String], description: 'Ids in the new order.' })
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids!: string[];
}

export class VariantDto {
  @ApiPropertyOptional({
    description: 'Keep an existing variant by sending its id.',
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ example: 'Full' })
  @Trim()
  @IsString()
  @Length(1, 60)
  name!: string;

  @ApiProperty({ example: 1800, description: 'Absolute price (rupees).' })
  @IsInt()
  @Min(0)
  @Max(500000)
  price!: number;
}

export class ItemDto {
  @IsUUID() categoryId!: string;

  @ApiProperty({ example: 'Chicken Karahi' })
  @Trim()
  @IsString()
  @Length(2, 120)
  name!: string;

  @ApiPropertyOptional({
    example: 'چکن کڑاہی',
    description: 'The name in Urdu script (voice commands match it too).',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 120)
  nameUr?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({
    example: 'کوئلے پر پکی خوشبودار چکن کڑاہی',
    description: 'The description in Urdu script.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(1000)
  descriptionUr?: string;

  @ApiPropertyOptional({
    description: 'secure_url of an upload signed for purpose menu_item.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  photoUrl?: string;

  @ApiProperty({
    example: 1600,
    description: 'Rupees. With variants, each variant has its own price.',
  })
  @IsInt()
  @Min(0)
  @Max(500000)
  basePrice!: number;

  @ApiPropertyOptional({ enum: ITEM_TAGS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsIn(ITEM_TAGS, { each: true })
  tags?: ItemTag[];

  @IsOptional() @IsBoolean() isDeal?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  serves?: number | null;

  @ApiPropertyOptional({
    type: [Number],
    description: 'Weekdays it is on the menu (0 = Sunday); all when absent.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  days?: number[];

  @IsOptional() @IsBoolean() isActive?: boolean;

  @ApiPropertyOptional({ type: [VariantDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => VariantDto)
  variants?: VariantDto[];
}

export class UpdateItemDto {
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @Trim() @IsString() @Length(2, 120) name?: string;

  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 120)
  nameUr?: string | null;

  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(1000)
  descriptionUr?: string | null;

  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  photoUrl?: string | null;

  @IsOptional() @IsInt() @Min(0) @Max(500000) basePrice?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsIn(ITEM_TAGS, { each: true })
  tags?: ItemTag[];

  @IsOptional() @IsBoolean() isDeal?: boolean;

  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  serves?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  days?: number[];

  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class OptionDto {
  @ApiPropertyOptional({
    description: 'Keep an existing option by sending its id.',
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ example: 'Extra cheese' })
  @Trim()
  @IsString()
  @Length(1, 80)
  name!: string;

  @ApiProperty({ example: 80 })
  @IsInt()
  @Min(0)
  @Max(100000)
  priceDelta!: number;

  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class OptionGroupDto {
  @ApiProperty({ example: 'Choose your drink' })
  @Trim()
  @IsString()
  @Length(1, 80)
  name!: string;

  @ApiProperty({ example: 1, description: '≥ 1 makes the group required.' })
  @IsInt()
  @Min(0)
  @Max(20)
  minSelect!: number;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  @Max(20)
  maxSelect!: number;

  @ApiProperty({ type: [OptionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => OptionDto)
  options!: OptionDto[];
}

export class ItemGroupLinkDto {
  @IsUUID() groupId!: string;

  @ApiPropertyOptional({
    description: 'Only for this variant; all variants when absent.',
  })
  @IsOptional()
  @IsUUID()
  variantId?: string;
}

export class ItemAvailabilityDto {
  @IsUUID() itemId!: string;
  @IsBoolean() isAvailable!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Off until this time (then back automatically).',
  })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsISO8601()
  unavailableUntil?: string | null;
}

export class OptionAvailabilityDto {
  @IsUUID() optionId!: string;
  @IsBoolean() isAvailable!: boolean;
}

export class AvailabilityPatchDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ItemAvailabilityDto)
  items?: ItemAvailabilityDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => OptionAvailabilityDto)
  options?: OptionAvailabilityDto[];
}

export class TodayItemDto {
  @IsUUID() itemId!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Portions cooked today (null = no limit).',
  })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5000)
  portions?: number | null;

  @ApiPropertyOptional({
    description: 'Cooking it today (false = off for today).',
  })
  @IsOptional()
  @IsBoolean()
  cooking?: boolean;
}

export class TodayPatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => TodayItemDto)
  items!: TodayItemDto[];
}

export class PreorderSlotDto {
  @IsInt() @Min(0) @Max(6) weekday!: number;

  @ApiProperty({ example: '13:00' })
  @Matches(HHMM)
  slotStart!: string;

  @ApiProperty({
    example: 180,
    description: 'Orders close this many minutes before the slot.',
  })
  @IsInt()
  @Min(0)
  @Max(2880)
  cutoffMinutesBefore!: number;

  @IsInt() @Min(1) @Max(500) maxOrders!: number;
}

export class WeeklyMenuEntryDto {
  @IsUUID() itemId!: string;

  @ApiProperty({ type: [Number], example: [5] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  days!: number[];
}
