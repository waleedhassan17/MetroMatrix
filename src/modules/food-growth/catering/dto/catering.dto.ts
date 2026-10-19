import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
import { CATERING_FULFILMENTS, EVENT_TYPES } from '../entities/catering.entity';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class RequestedItemDto {
  @IsOptional() @IsUUID() menuItemId?: string;
  @Trim() @IsString() @Length(1, 120) name!: string;
  @IsOptional() @IsInt() @Min(1) @Max(5000) qty?: number;
}

export class CateringRequestDto {
  @ApiProperty({ description: 'The vendor (brand) id.' })
  @IsUUID()
  vendorId!: string;
  @ApiProperty({ example: '2026-11-14' })
  @IsISO8601({ strict: true })
  eventDate!: string;
  @ApiProperty({ example: '19:30' }) @Matches(HHMM) eventTime!: string;
  @ApiProperty({ example: 60 }) @IsInt() @Min(1) @Max(5000) guests!: number;
  @ApiProperty({ enum: EVENT_TYPES })
  @IsIn(EVENT_TYPES)
  eventType!: (typeof EVENT_TYPES)[number];

  @ApiProperty({
    type: [RequestedItemDto],
    description: 'Dishes from the menu (with qty) or free text.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => RequestedItemDto)
  requestedItems!: RequestedItemDto[];

  @IsOptional() @IsInt() @Min(0) @Max(10_000_000) budget?: number;
  @ApiProperty({ enum: CATERING_FULFILMENTS })
  @IsIn(CATERING_FULFILMENTS)
  fulfilment!: (typeof CATERING_FULFILMENTS)[number];
  @ApiPropertyOptional({
    description: 'Delivery or on-site: a pinned address of yours.',
  })
  @IsOptional()
  @IsUUID()
  addressId?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(2000) notes?: string;
}

export class QuoteLineDto {
  @IsOptional() @IsUUID() menuItemId?: string;
  @Trim() @IsString() @Length(1, 120) name!: string;
  @IsInt() @Min(1) @Max(5000) qty!: number;
  @ApiProperty({ description: 'Rupees each.' })
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  unitPrice!: number;
}

export class QuoteDto {
  @ApiProperty({ type: [QuoteLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => QuoteLineDto)
  lines!: QuoteLineDto[];

  @IsOptional() @IsInt() @Min(0) @Max(100000) deliveryFee?: number;
  @ApiProperty({
    example: 30,
    description: 'Advance, % of the total, paid to you before you confirm.',
  })
  @IsInt()
  @Min(0)
  @Max(100)
  advancePct!: number;
  @ApiPropertyOptional({
    description: 'Default 3 days, never after the event.',
  })
  @IsOptional()
  @IsISO8601()
  validUntil?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(2000) notes?: string;
}

export class AcceptQuoteDto {
  @ApiProperty({
    description: 'The version you saw (an older one is refused).',
  })
  @IsInt()
  @Min(1)
  version!: number;
}

export class CateringReasonDto {
  @Trim() @IsString() @Length(3, 300) reason!: string;
}

export class AdvanceProofDto {
  @ApiProperty({ description: 'A `payment_proof` upload of yours.' })
  @IsString()
  @MaxLength(500)
  proofUrl!: string;
  @IsOptional() @IsString() @MaxLength(300) publicId?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(60) ref?: string;
}

export class CateringQueryDto {
  @IsOptional()
  @IsIn([
    'requested',
    'quoted',
    'accepted',
    'advance_proof',
    'confirmed',
    'completed',
    'declined',
    'expired',
    'cancelled',
  ])
  status?: string;
}
