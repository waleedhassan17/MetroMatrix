import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  Min,
  ValidateIf,
} from 'class-validator';
import { Trim } from '../../../../common/validation/transforms';
import { PaginationQueryDto } from '../../../../common/pagination/pagination';
import { PAYMENT_METHODS, PaymentMethod } from '../payment-status';
import { APPOINTMENT_STATUSES, AppointmentStatus } from '../appointment-status';

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
}

export class CompleteDto {
  @ApiPropertyOptional({
    description: 'Pay-at-clinic: the fee was collected (→ paid).',
  })
  @IsOptional()
  @IsBoolean()
  paymentCollected?: boolean;
}
