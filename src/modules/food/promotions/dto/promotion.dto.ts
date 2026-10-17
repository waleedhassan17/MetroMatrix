import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
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
  Min,
  ValidateIf,
} from 'class-validator';
import { Trim } from '../../../../common/validation/transforms';
import { PaginationQueryDto } from '../../../../common/pagination/pagination';
import {
  PROMOTION_KINDS,
  PromotionKind,
} from '../entities/food-promotion.entity';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class PromotionDto {
  @ApiProperty({ example: 'Happy hour' })
  @Trim()
  @IsString()
  @Length(2, 80)
  title!: string;

  @ApiProperty({ enum: PROMOTION_KINDS })
  @IsIn(PROMOTION_KINDS)
  kind!: PromotionKind;

  @ApiPropertyOptional({
    description:
      'Percent (1–100) for percent kinds, rupees for flat_off; not used by free_delivery.',
    example: 20,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  value?: number;

  @ApiPropertyOptional({
    type: [String],
    description: 'percent_off_items: the dishes it applies to.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  itemIds?: string[];

  @ApiPropertyOptional({ example: 800 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000)
  minOrder?: number;

  @ApiPropertyOptional({ nullable: true, example: 300 })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000000)
  maxDiscount?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 'KARAHI20',
    description: 'null = an automatic deal shown on cards.',
  })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @Trim()
  @Matches(/^[A-Za-z0-9-]{3,20}$/, {
    message: 'code is 3–20 letters, digits or dashes',
  })
  code?: string | null;

  @ApiPropertyOptional({ description: 'Defaults to now.' })
  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsISO8601()
  endsAt?: string | null;

  @ApiPropertyOptional({
    type: [Number],
    description: 'Weekdays it runs (0 = Sunday); every day when absent.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekdays?: number[];

  @ApiPropertyOptional({ nullable: true, example: '15:00' })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @Matches(HHMM, { message: 'timeFrom is HH:MM' })
  timeFrom?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '18:00' })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @Matches(HHMM, { message: 'timeTo is HH:MM' })
  timeTo?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsInt()
  @Min(1)
  usageLimit?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsInt()
  @Min(1)
  perUserLimit?: number | null;

  @IsOptional() @IsBoolean() firstOrderOnly?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdatePromotionDto extends PartialType(PromotionDto) {}

export const PROMOTION_STATES = [
  'live',
  'scheduled',
  'ended',
  'inactive',
] as const;
export type PromotionState = (typeof PROMOTION_STATES)[number];

export class PromotionQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PROMOTION_STATES })
  @IsOptional()
  @IsIn(PROMOTION_STATES)
  state?: PromotionState;
}
