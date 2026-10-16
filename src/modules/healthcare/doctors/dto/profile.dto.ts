import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Trim } from '../../../../common/validation/transforms';
import {
  DOCTOR_TITLES,
  DoctorTitle,
  GENDERS,
  Gender,
} from '../entities/doctor.entity';

const THIS_YEAR = new Date().getUTCFullYear();

export class QualificationDto {
  @ApiProperty({ example: 'MBBS' })
  @Trim()
  @IsString()
  @Length(2, 80)
  degree!: string;

  @ApiProperty({ example: 'King Edward Medical University' })
  @Trim()
  @IsString()
  @Length(2, 160)
  institute!: string;

  @ApiPropertyOptional({ nullable: true, example: 2012 })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsInt()
  @Min(1950)
  @Max(THIS_YEAR)
  year?: number | null;
}

export class ExperienceDto {
  @ApiProperty({ example: 'Consultant Dermatologist' })
  @Trim()
  @IsString()
  @Length(2, 120)
  designation!: string;

  @ApiProperty({ example: 'Services Hospital, Lahore' })
  @Trim()
  @IsString()
  @Length(2, 160)
  institute!: string;

  @ApiProperty({ example: 2016 })
  @IsInt()
  @Min(1950)
  @Max(THIS_YEAR)
  fromYear!: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'null = current position',
  })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsInt()
  @Min(1950)
  @Max(THIS_YEAR)
  toYear?: number | null;
}

/**
 * Every field optional. List fields (qualifications, experiences, services,
 * conditionIds, secondarySpecialtyIds, languages) REPLACE the stored list.
 */
export class UpdateDoctorProfileDto {
  @ApiPropertyOptional({ enum: DOCTOR_TITLES })
  @IsOptional()
  @IsIn(DOCTOR_TITLES)
  title?: DoctorTitle;

  @ApiPropertyOptional({ example: 'Sana Iqbal' })
  @IsOptional()
  @Trim()
  @IsString()
  @Length(3, 120)
  fullName?: string;

  @ApiPropertyOptional({ enum: GENDERS })
  @IsOptional()
  @IsIn(GENDERS)
  gender?: Gender;

  @ApiPropertyOptional({
    nullable: true,
    description: 'secure_url of an upload signed for purpose doctor_photo.',
  })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  photoUrl?: string | null;

  @ApiPropertyOptional({
    description: 'Only while unverified; changes the business too.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @Length(3, 20)
  pmdcNumber?: string;

  @IsOptional()
  @IsUUID()
  primarySpecialtyId?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  secondarySpecialtyIds?: string[];

  @ApiPropertyOptional({ example: 2010 })
  @IsOptional()
  @IsInt()
  @Min(1950)
  @Max(THIS_YEAR)
  practicingSince?: number;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(3000)
  about?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['English', 'Urdu', 'Punjabi'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @Length(2, 30, { each: true })
  languages?: string[];

  @ApiPropertyOptional({ default: 14, minimum: 1, maximum: 30 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  bookingWindowDays?: number;

  @ApiPropertyOptional({ default: 60 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2880)
  minNoticeMinutes?: number;

  @ApiPropertyOptional({ default: 120 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2880)
  cancelCutoffMinutes?: number;

  @ApiPropertyOptional({
    description: 'Video patients must transfer the fee before the call.',
  })
  @IsOptional()
  @IsBoolean()
  videoPrepayRequired?: boolean;

  @ApiPropertyOptional({
    description: 'false pauses new bookings without unpublishing.',
  })
  @IsOptional()
  @IsBoolean()
  isAccepting?: boolean;

  @ApiPropertyOptional({ type: [QualificationDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(15)
  @ValidateNested({ each: true })
  @Type(() => QualificationDto)
  qualifications?: QualificationDto[];

  @ApiPropertyOptional({ type: [ExperienceDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ExperienceDto)
  experiences?: ExperienceDto[];

  @ApiPropertyOptional({ type: [String], example: ['Acne scar treatment'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @Length(2, 120, { each: true })
  services?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  conditionIds?: string[];
}

export class DoctorPaymentAccountDto {
  @ApiProperty({ enum: ['raast', 'jazzcash', 'easypaisa', 'bank'] })
  @IsIn(['raast', 'jazzcash', 'easypaisa', 'bank'])
  kind!: 'raast' | 'jazzcash' | 'easypaisa' | 'bank';

  @ApiProperty({ example: 'Dr Sana Iqbal' })
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

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateDoctorPaymentAccountDto {
  @IsOptional()
  @Trim()
  @IsString()
  @Length(2, 80)
  accountTitle?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @Length(2, 80)
  bankName?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
