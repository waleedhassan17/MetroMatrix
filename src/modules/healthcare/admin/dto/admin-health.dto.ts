import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
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
} from 'class-validator';
import {
  APPOINTMENT_STATUSES,
  AppointmentStatus,
} from '../../appointments/appointment-status';
import { Trim } from '../../../../common/validation/transforms';
import { PaginationQueryDto } from '../../../../common/pagination/pagination';

export class AdminDoctorQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['verified', 'unverified'] })
  @IsOptional()
  @IsIn(['verified', 'unverified'])
  pmdc?: 'verified' | 'unverified';

  @IsOptional()
  @IsUUID()
  businessId?: string;

  @ApiPropertyOptional({ description: 'Name or PMDC number.' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(60)
  q?: string;
}

export class AdminNoteDto {
  @IsOptional()
  @Trim()
  @IsString()
  @Length(3, 500)
  note?: string;
}

export class AdminReasonDto {
  @ApiProperty({ example: 'PMDC registration lapsed.' })
  @Trim()
  @IsString()
  @Length(3, 500)
  reason!: string;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class SpecialtyDto {
  @ApiProperty({ example: 'Dermatologist' })
  @Trim()
  @IsString()
  @Length(2, 80)
  name!: string;

  @ApiProperty({ example: 'ماہر امراض جلد' })
  @Trim()
  @IsString()
  @Length(2, 120)
  nameUr!: string;

  @ApiProperty({ example: 'dermatologist' })
  @Trim()
  @Matches(SLUG, { message: 'slug is lower-case words joined by "-"' })
  @Length(2, 60)
  slug!: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(40)
  icon?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ example: ['skin', 'jild'] })
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @Length(2, 40, { each: true })
  keywords!: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  sort?: number;
}

export class UpdateSpecialtyDto extends PartialType(SpecialtyDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ConditionDto {
  @ApiProperty({ example: 'Acne' })
  @Trim()
  @IsString()
  @Length(2, 100)
  name!: string;

  @IsOptional()
  @Trim()
  @IsString()
  @Length(2, 140)
  nameUr?: string;

  @ApiProperty({ example: 'acne' })
  @Trim()
  @Matches(SLUG, { message: 'slug is lower-case words joined by "-"' })
  @Length(2, 80)
  slug!: string;

  @ApiProperty({ example: ['pimples', 'daane'] })
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @Length(2, 60, { each: true })
  aliases!: string[];

  @IsOptional()
  @IsBoolean()
  isCommon?: boolean;
}

export class UpdateConditionDto extends PartialType(ConditionDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ConditionSpecialtyDto {
  @IsUUID()
  specialtyId!: string;

  @ApiProperty({ description: '1 = first choice' })
  @IsInt()
  @Min(1)
  @Max(10)
  rank!: number;
}

export class AdminConditionQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(60)
  q?: string;
}

export class AdminAppointmentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'HC-XXXXXX (exact).' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(20)
  code?: string;

  @IsOptional()
  @IsUUID()
  doctorId?: string;

  @IsOptional()
  @IsUUID()
  patientUserId?: string;

  @ApiPropertyOptional({ enum: APPOINTMENT_STATUSES })
  @IsOptional()
  @IsIn(APPOINTMENT_STATUSES)
  status?: AppointmentStatus;

  @ApiPropertyOptional({ example: '2026-10-16', description: 'One PKT day.' })
  @IsOptional()
  @IsISO8601({ strict: true })
  date?: string;
}
