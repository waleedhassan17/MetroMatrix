import { PAUSE_REASONS, PauseReason } from '../entities/branch.entity';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsLatitude,
  IsLongitude,
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
} from 'class-validator';
import { Trim } from '../../../../common/validation/transforms';
import { IsPkPhone } from '../../../../common/validation/phone';
import { HEX_COLOR } from '../../../../common/branding/contrast';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;

export class UpdateProfileDto {
  @IsOptional() @Trim() @IsString() @Length(2, 120) name?: string;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(140)
  tagline?: string | null;

  @ApiPropertyOptional({
    description: 'secure_url of an upload signed for purpose food_branding.',
    nullable: true,
  })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  coverUrl?: string | null;

  @ApiPropertyOptional({ type: [String], description: '1–3 cuisine ids' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsUUID('all', { each: true })
  cuisineIds?: string[];

  @ApiPropertyOptional({ minimum: 1, maximum: 3 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  priceLevel?: number;

  @ApiPropertyOptional({
    example: '#B4532A',
    description:
      'Refused when neither white nor ink text passes WCAG AA on it.',
  })
  @IsOptional()
  @Matches(HEX_COLOR, { message: 'brandColor is #RRGGBB' })
  brandColor?: string;
}

export class UpdateSettingsDto {
  @IsOptional() @IsBoolean() acceptsDelivery?: boolean;
  @IsOptional() @IsBoolean() acceptsPickup?: boolean;
  @IsOptional() @IsBoolean() acceptsCod?: boolean;

  @ApiPropertyOptional({
    description: 'Largest cash-on-delivery order (rupees).',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(200000)
  codLimit?: number;

  @ApiPropertyOptional({
    description:
      'Transfer orders wait for the vendor to confirm payment before cooking.',
  })
  @IsOptional()
  @IsBoolean()
  transferConfirmBeforePrep?: boolean;

  @ApiPropertyOptional({ minimum: 3, maximum: 10 })
  @IsOptional()
  @IsInt()
  @Min(3)
  @Max(10)
  autoRejectMinutes?: number;

  @ApiPropertyOptional({ minimum: 5, maximum: 180 })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(180)
  prepMinutes?: number;

  @ApiPropertyOptional({ minimum: 0.5, maximum: 50 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.5)
  @Max(50)
  maxRadiusKm?: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Delivery is free from this subtotal (rupees).',
  })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(200000)
  freeDeliveryOver?: number | null;

  @ApiPropertyOptional({
    description: 'Home kitchens: take scheduled (pre-)orders only.',
  })
  @IsOptional()
  @IsBoolean()
  preorderOnly?: boolean;

  @IsOptional() @Trim() @IsString() @Length(5, 255) addressLine?: string;
  @IsOptional() @Trim() @IsString() @Length(2, 80) area?: string;
  @IsOptional() @Trim() @IsString() @Length(2, 60) city?: string;
  @IsOptional() @IsLatitude() lat?: number;
  @IsOptional() @IsLongitude() lng?: number;

  @ApiPropertyOptional({ description: 'Pakistani number; landlines allowed.' })
  @IsOptional()
  @IsPkPhone({ allowLandline: true })
  phone?: string;
}

export class HoursRangeDto {
  @ApiProperty({ minimum: 0, maximum: 6, description: '0 = Sunday' })
  @IsInt()
  @Min(0)
  @Max(6)
  weekday!: number;

  @ApiProperty({ example: '18:00' })
  @Matches(HHMM, { message: 'opensAt is HH:MM' })
  opensAt!: string;

  @ApiProperty({
    example: '02:00',
    description: 'Earlier than opensAt = past midnight.',
  })
  @Matches(HHMM, { message: 'closesAt is HH:MM (or 24:00)' })
  closesAt!: string;
}

export class FeeBandDto {
  @ApiProperty({ example: 0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(50)
  fromKm!: number;

  @ApiProperty({ example: 3 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.1)
  @Max(50)
  toKm!: number;

  @ApiProperty({ example: 99 })
  @IsInt()
  @Min(0)
  @Max(5000)
  fee!: number;

  @ApiProperty({ example: 500 })
  @IsInt()
  @Min(0)
  @Max(50000)
  minOrder!: number;
}

export class ClosureDto {
  @ApiProperty({ example: '2026-11-01T00:00:00+05:00' })
  @IsISO8601()
  startsAt!: string;

  @ApiProperty({ example: '2026-11-02T00:00:00+05:00' })
  @IsISO8601()
  endsAt!: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class PauseDto {
  @ApiPropertyOptional({ example: 'Back after Maghrib.' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200)
  message?: string;

  @ApiPropertyOptional({
    enum: PAUSE_REASONS,
    description:
      'Why (gas, electricity…) — for you and staff only; customers never see it.',
  })
  @IsOptional()
  @IsIn(PAUSE_REASONS)
  reason?: PauseReason;

  @ApiPropertyOptional({
    minimum: 5,
    maximum: 720,
    description:
      'Resume by itself after this long; customers see “back around 4:30 PM”.',
  })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(720)
  minutes?: number;
}

export class BusyDto {
  @ApiProperty({ minimum: 0, maximum: 60, description: '0 clears busy mode.' })
  @IsInt()
  @Min(0)
  @Max(60)
  extraMinutes!: number;

  @ApiPropertyOptional({
    description: 'Until when (at most 6 hours ahead); defaults to 1 hour.',
  })
  @IsOptional()
  @IsISO8601()
  until?: string;
}

export class VendorPaymentAccountDto {
  @ApiProperty({ enum: ['raast', 'jazzcash', 'easypaisa', 'bank'] })
  @IsIn(['raast', 'jazzcash', 'easypaisa', 'bank'])
  kind!: 'raast' | 'jazzcash' | 'easypaisa' | 'bank';

  @ApiProperty({ example: 'Karahi House' })
  @Trim()
  @IsString()
  @Length(2, 80)
  accountTitle!: string;

  @ApiProperty({ description: 'IBAN for bank; the mobile number otherwise.' })
  @IsString()
  @Length(5, 40)
  accountNumber!: string;

  @ApiPropertyOptional({ description: 'Required for bank accounts.' })
  @IsOptional()
  @Trim()
  @IsString()
  @Length(2, 80)
  bankName?: string;

  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateVendorPaymentAccountDto {
  @IsOptional() @Trim() @IsString() @Length(2, 80) accountTitle?: string;
  @IsOptional() @Trim() @IsString() @Length(2, 80) bankName?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class FoodSafetyCheckDto {
  @ApiProperty({ enum: ['passed', 'failed'] })
  @IsIn(['passed', 'failed'])
  outcome!: 'passed' | 'failed';

  @ApiProperty({
    example: 'Test order on 12 Oct: clean kitchen, sealed packaging.',
  })
  @Trim()
  @IsString()
  @Length(3, 1000)
  note!: string;
}
