import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
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
import {
  LOCATION_KINDS,
  LocationKind,
} from '../entities/practice-location.entity';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;

export class CreateLocationDto {
  @ApiProperty({ enum: LOCATION_KINDS })
  @IsIn(LOCATION_KINDS)
  kind!: LocationKind;

  @ApiPropertyOptional({
    example: 'Hameed Latif Hospital',
    description: 'Defaults to "Video consultation" for video.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @Length(2, 140)
  name?: string;

  @ApiPropertyOptional({ description: 'Clinic: required.' })
  @IsOptional()
  @Trim()
  @IsString()
  @Length(5, 255)
  addressLine?: string;

  @ApiPropertyOptional({
    example: 'Gulberg III',
    description: 'Clinic: required.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @Length(2, 80)
  area?: string;

  @ApiPropertyOptional({ example: 'Lahore', description: 'Clinic: required.' })
  @IsOptional()
  @Trim()
  @IsString()
  @Length(2, 60)
  city?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-180)
  @Max(180)
  lng?: number;

  @IsOptional()
  @IsPkPhone({ allowLandline: true })
  phone?: string;

  @ApiPropertyOptional({ default: 'Asia/Karachi' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  timezone?: string;

  @ApiProperty({ example: 2500, description: 'Rupees.' })
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  fee!: number;

  @ApiPropertyOptional({ default: 15, minimum: 10, maximum: 60 })
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(60)
  slotMinutes?: number;

  @ApiPropertyOptional({ example: 'Ask for a token at reception.' })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(500)
  instructions?: string | null;
}

export class UpdateLocationDto {
  @IsOptional() @Trim() @IsString() @Length(2, 140) name?: string;
  @IsOptional() @Trim() @IsString() @Length(5, 255) addressLine?: string;
  @IsOptional() @Trim() @IsString() @Length(2, 80) area?: string;
  @IsOptional() @Trim() @IsString() @Length(2, 60) city?: string;
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-90)
  @Max(90)
  lat?: number;
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-180)
  @Max(180)
  lng?: number;
  @IsOptional() @IsPkPhone({ allowLandline: true }) phone?: string;
  @IsOptional() @IsString() @MaxLength(60) timezone?: string;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) fee?: number;
  @IsOptional() @IsInt() @Min(10) @Max(60) slotMinutes?: number;
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(500)
  instructions?: string | null;
  @ApiPropertyOptional({
    description:
      'false hides the location; refused while it has future bookings.',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ScheduleRangeDto {
  @ApiProperty({
    minimum: 0,
    maximum: 6,
    description: '0 = Sunday … 6 = Saturday',
  })
  @IsInt()
  @Min(0)
  @Max(6)
  weekday!: number;

  @ApiProperty({
    example: '14:00',
    description: 'Local wall-clock time, HH:mm.',
  })
  @Matches(HHMM, { message: 'start must be HH:mm' })
  start!: string;

  @ApiProperty({ example: '19:00' })
  @Matches(HHMM, { message: 'end must be HH:mm (24:00 allowed)' })
  end!: string;
}

export class CreateTimeOffDto {
  @ApiProperty({ example: '2026-10-23T00:00:00+05:00' })
  @IsISO8601({ strict: true })
  startsAt!: string;

  @ApiProperty({ example: '2026-10-24T00:00:00+05:00' })
  @IsISO8601({ strict: true })
  endsAt!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'One location; omit for everywhere.',
  })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsUUID()
  locationId?: string | null;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200)
  reason?: string;

  @ApiPropertyOptional({
    description:
      'Cancel the booked appointments it covers (patients are told).',
  })
  @IsOptional()
  @IsBoolean()
  cancelAffected?: boolean;
}
