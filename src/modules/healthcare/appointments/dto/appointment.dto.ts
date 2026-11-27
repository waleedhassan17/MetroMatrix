import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
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
  MaxLength,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Trim } from '../../../../common/validation/transforms';
import { IsPkPhone } from '../../../../common/validation/phone';
import { PaginationQueryDto } from '../../../../common/pagination/pagination';
import { PAYMENT_METHODS, PaymentMethod } from '../payment-status';
import { APPOINTMENT_STATUSES, AppointmentStatus } from '../appointment-status';

/** The doctor's "Needs you" lists (GET /health/doctor/appointments?needs=…). */
export const DOCTOR_NEEDS = [
  'transfer',
  'fee',
  'prescription',
  'refund',
] as const;
export type DoctorNeed = (typeof DOCTOR_NEEDS)[number];

export class BookAppointmentDto {
  @ApiProperty()
  @IsUUID()
  doctorId!: string;

  @ApiProperty()
  @IsUUID()
  locationId!: string;

  @ApiProperty({
    example: '2026-10-17T14:00:00.000+05:00',
    description: 'Exactly one of the slots from /slots.',
  })
  @IsISO8601({ strict: true })
  startsAt!: string;

  @ApiPropertyOptional({
    description: 'Book for a family member instead of yourself.',
  })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsUUID()
  familyMemberId?: string | null;

  @ApiPropertyOptional({ example: 'Rash on both arms for a week' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiPropertyOptional({ type: [String], example: ['itching', 'redness'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(15)
  @IsString({ each: true })
  @Length(2, 60, { each: true })
  symptoms?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Your health records to share with the doctor.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  attachmentRecordIds?: string[];

  @ApiPropertyOptional({
    enum: PAYMENT_METHODS,
    description: 'clinic → pay_at_clinic; video → transfer. Defaults by kind.',
  })
  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  paymentMethod?: PaymentMethod;

  /** Ignored: the fee always comes from the location. Accepted so old clients don't fail validation. */
  @IsOptional()
  @IsInt()
  @Min(0)
  fee?: number;
}

export class RescheduleDto {
  @ApiProperty({ example: '2026-10-18T10:00:00.000+05:00' })
  @IsISO8601({ strict: true })
  startsAt!: string;
}

export class AppointmentReasonDto {
  @ApiProperty({ example: 'Something came up at work.' })
  @Trim()
  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class PaymentProofDto {
  @ApiProperty({ example: 'IBFT 88123' })
  @Trim()
  @IsString()
  @Length(3, 100)
  paymentRef!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'secure_url of an upload signed for purpose payment_proof.',
  })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  proofUrl?: string | null;
}

export class RefundDto {
  @ApiProperty({ example: 'IBFT 99120' })
  @Trim()
  @IsString()
  @Length(3, 100)
  refundRef!: string;
}

export class PatientAppointmentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['upcoming', 'past'], default: 'upcoming' })
  @IsOptional()
  @IsIn(['upcoming', 'past'])
  scope?: 'upcoming' | 'past';
}

export class DoctorAppointmentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: '2026-10-16', description: 'One local day.' })
  @IsOptional()
  @IsISO8601({ strict: true })
  date?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

  @ApiPropertyOptional({ enum: APPOINTMENT_STATUSES })
  @IsOptional()
  @IsIn(APPOINTMENT_STATUSES)
  status?: AppointmentStatus;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({
    enum: DOCTOR_NEEDS,
    description:
      "What still needs the doctor, any date: transfer (proof to confirm), fee (a clinic fee to mark paid, last 30 days), prescription (completed in the last 24 hours, none written), refund (refund due). The counts are today's `attention`.",
  })
  @IsOptional()
  @IsIn(DOCTOR_NEEDS)
  needs?: DoctorNeed;
}

export class CompleteDto {
  @ApiPropertyOptional({
    description: 'Pay-at-clinic: the fee was collected (→ paid).',
  })
  @IsOptional()
  @IsBoolean()
  paymentCollected?: boolean;
}

export class DoctorRescheduleDto {
  @ApiProperty({
    example: '2026-10-18T10:00:00.000+05:00',
    description:
      'One of your free slots (GET /health/doctor/locations/:id/slots).',
  })
  @IsISO8601({ strict: true })
  startsAt!: string;

  @ApiPropertyOptional({
    description: 'Another location of the same kind; default the same one.',
  })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiProperty({ example: 'I have a surgery that morning.' })
  @Trim()
  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class FollowUpDto {
  @ApiProperty({
    description: 'The location for the follow-up (clinic or video).',
  })
  @IsUUID()
  locationId!: string;

  @ApiProperty({ example: '2026-11-08T10:00:00.000+05:00' })
  @IsISO8601({ strict: true })
  startsAt!: string;
}

export class WalkInPersonDto {
  @ApiProperty({ example: 'Bilal Ahmed' })
  @Trim()
  @IsString()
  @Length(2, 120)
  name!: string;

  @ApiPropertyOptional({ example: '+923001234567' })
  @IsOptional()
  @IsPkPhone()
  phone?: string;

  @ApiPropertyOptional({ enum: ['male', 'female', 'other'] })
  @IsOptional()
  @IsIn(['male', 'female', 'other'])
  gender?: 'male' | 'female' | 'other';

  @ApiPropertyOptional({ minimum: 0, maximum: 120 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  age?: number;
}

export class WalkInDto {
  @ApiProperty({ description: 'One of your clinics.' })
  @IsUUID()
  locationId!: string;

  @ApiPropertyOptional({
    description:
      'A free slot today; default the current one (or the next free today).',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  startsAt?: string;

  @ApiProperty({ type: WalkInPersonDto })
  @ValidateNested()
  @Type(() => WalkInPersonDto)
  patient!: WalkInPersonDto;

  @ApiPropertyOptional({ example: 'Fever since yesterday' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
