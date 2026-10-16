import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Trim } from '../../../../common/validation/transforms';
import { PaginationQueryDto } from '../../../../common/pagination/pagination';

const SLUG_QUERY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const DOCTOR_SORTS = [
  'recommended',
  'earliest',
  'fee_asc',
  'fee_desc',
  'reviews',
  'experience',
] as const;
export type DoctorSort = (typeof DOCTOR_SORTS)[number];

export class DoctorQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Name, specialty, condition or symptom — English, Urdu, Roman Urdu; typos tolerated.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(80)
  q?: string;

  @IsOptional()
  @IsUUID()
  specialtyId?: string;

  @IsOptional()
  @IsUUID()
  conditionId?: string;

  @ApiPropertyOptional({
    example: 'dermatologist',
    description: 'A specialty by slug (the same as specialtyId).',
  })
  @IsOptional()
  @Matches(SLUG_QUERY, { message: 'specialty is a slug' })
  @MaxLength(80)
  specialty?: string;

  @ApiPropertyOptional({
    example: 'acne',
    description: 'A condition by slug (the same as conditionId).',
  })
  @IsOptional()
  @Matches(SLUG_QUERY, { message: 'condition is a slug' })
  @MaxLength(80)
  condition?: string;

  @ApiPropertyOptional({
    description: 'Doctors with a clinic in this city (ignored for kind=video).',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(60)
  city?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(80)
  area?: string;

  @ApiPropertyOptional({ enum: ['clinic', 'video'] })
  @IsOptional()
  @IsIn(['clinic', 'video'])
  kind?: 'clinic' | 'video';

  @ApiPropertyOptional({
    description: 'A free slot today (doctor’s local day).',
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  availableToday?: 'true' | 'false';

  @IsOptional()
  @IsIn(['male', 'female'])
  gender?: 'male' | 'female';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minFee?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxFee?: number;

  @ApiPropertyOptional({ description: 'Years.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60)
  minExperience?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(5)
  minRating?: number;

  @ApiPropertyOptional({ example: 'Punjabi' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(30)
  language?: string;

  @ApiPropertyOptional({
    description:
      'With lng: distance-aware "recommended" and distanceKm on cards.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @ApiPropertyOptional({ enum: DOCTOR_SORTS, default: 'recommended' })
  @IsOptional()
  @IsIn(DOCTOR_SORTS)
  sort?: DoctorSort;
}

export class SlotsQueryDto {
  @ApiPropertyOptional({
    example: '2026-10-16',
    description: 'Local date; defaults to today.',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ default: 7, minimum: 1, maximum: 14 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(14)
  days?: number;
}

export class HomeQueryDto {
  @ApiPropertyOptional({
    example: 'Lahore',
    description:
      'Defaults to the patient’s default address city (when doctors practise there), else the city with the most doctors.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(60)
  city?: string;
}

export class CityQueryDto {
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(60)
  city?: string;
}
