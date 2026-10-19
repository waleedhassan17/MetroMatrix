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
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Trim } from '../../../../common/validation/transforms';
import {
  TIFFIN_DELIVERY_MODES,
  TIFFIN_MEALS,
  TIFFIN_PERIODS,
} from '../entities/tiffin.entity';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class RotationDayDto {
  @IsInt() @Min(0) @Max(6) weekday!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(6)
  @IsUUID('all', { each: true })
  menuItemIds!: string[];

  @IsOptional() @Trim() @IsString() @MaxLength(200) note?: string;
}

export class TiffinPlanDto {
  @ApiProperty({ example: 'Office lunch — Mon to Fri' })
  @Trim()
  @IsString()
  @Length(3, 80)
  name!: string;
  @IsOptional() @Trim() @IsString() @MaxLength(1000) description?: string;
  @ApiProperty({ enum: TIFFIN_MEALS })
  @IsIn(TIFFIN_MEALS)
  meal!: (typeof TIFFIN_MEALS)[number];

  @ApiProperty({ type: [Number], description: 'Weekdays served (0 = Sunday).' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  days!: number[];

  @ApiProperty({ enum: TIFFIN_PERIODS })
  @IsIn(TIFFIN_PERIODS)
  period!: (typeof TIFFIN_PERIODS)[number];
  @ApiProperty({ example: 3500, description: 'Rupees per week or month.' })
  @IsInt()
  @Min(1)
  @Max(500000)
  pricePerPeriod!: number;
  @ApiProperty({ enum: TIFFIN_DELIVERY_MODES })
  @IsIn(TIFFIN_DELIVERY_MODES)
  deliveryMode!: (typeof TIFFIN_DELIVERY_MODES)[number];
  @ApiProperty({ example: '12:30' }) @Matches(HHMM) deliveryWindowFrom!: string;
  @ApiProperty({ example: '13:30' }) @Matches(HHMM) deliveryWindowTo!: string;
  @ApiProperty({ example: 25 }) @IsInt() @Min(1) @Max(1000) capacity!: number;

  @ApiPropertyOptional({
    default: 20,
    description: 'Skips close at this hour the day before (20 = 8 PM).',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  skipCutoffHour?: number;

  @ApiProperty({
    type: [RotationDayDto],
    description: 'What is cooked on each day served.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => RotationDayDto)
  rotation!: RotationDayDto[];

  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class SubscribeDto {
  @IsUUID() planId!: string;
  @ApiProperty({ example: '2026-10-26' })
  @IsISO8601({ strict: true })
  startsOn!: string;
  @ApiProperty({ enum: ['cash_weekly', 'transfer_per_period'] })
  @IsIn(['cash_weekly', 'transfer_per_period'])
  paymentMethod!: 'cash_weekly' | 'transfer_per_period';
  @ApiProperty({ enum: ['delivery', 'pickup'] })
  @IsIn(['delivery', 'pickup'])
  fulfilment!: 'delivery' | 'pickup';
  @ApiPropertyOptional({
    description: 'Required for delivery (a pinned address).',
  })
  @IsOptional()
  @IsUUID()
  addressId?: string;
}

export class TiffinDateDto {
  @ApiProperty({ example: '2026-10-28' })
  @IsISO8601({ strict: true })
  date!: string;
}

export class TiffinPauseDto {
  @ApiProperty({ description: 'Last day without meals (inclusive).' })
  @IsISO8601({ strict: true })
  until!: string;
}

export class TiffinReasonDto {
  @Trim() @IsString() @Length(3, 300) reason!: string;
}

export class TiffinProofDto {
  @ApiProperty({ description: 'A `payment_proof` upload of yours.' })
  @IsString()
  @MaxLength(500)
  proofUrl!: string;
  @IsOptional() @IsString() @MaxLength(300) publicId?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(60) ref?: string;
}

export class TiffinSubscriptionsQueryDto {
  @IsOptional()
  @IsIn(['requested', 'active', 'paused', 'cancelled', 'ended', 'declined'])
  status?: string;
  @IsOptional() @IsUUID() planId?: string;
}

export class TomorrowQueryDto {
  @ApiPropertyOptional({ description: 'Default tomorrow.' })
  @IsOptional()
  @IsISO8601({ strict: true })
  date?: string;
}
