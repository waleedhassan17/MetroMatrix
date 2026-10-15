import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Trim } from '../../../../common/validation/transforms';
import { IsPkPhone } from '../../../../common/validation/phone';
import { PaginationQueryDto } from '../../../../common/pagination/pagination';
import { ORDER_BUCKETS, ORDER_STATUSES, OrderStatus } from '../order-status';
import { PAYMENT_STATUSES, PaymentStatus } from '../payment-status';

export class CustomerOrderQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: Object.keys(ORDER_BUCKETS) })
  @IsOptional()
  @IsIn(Object.keys(ORDER_BUCKETS))
  status?: keyof typeof ORDER_BUCKETS;
}

export class PartnerOrderQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ORDER_STATUSES })
  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: OrderStatus;

  @ApiPropertyOptional({ enum: PAYMENT_STATUSES })
  @IsOptional()
  @IsIn(PAYMENT_STATUSES)
  paymentStatus?: PaymentStatus;

  @ApiPropertyOptional({ description: 'Order code, customer name or phone.' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(60)
  q?: string;
}

/** Cancel, reject, request-cancel, payment reject: a reason is required. */
export class ReasonDto {
  @ApiProperty({ example: 'Ordered the wrong size.' })
  @Trim()
  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class PaymentProofDto {
  @ApiProperty({
    example: 'TXN 8812 3341',
    description: 'The transfer reference / transaction id.',
  })
  @Trim()
  @IsString()
  @Length(3, 100)
  paymentRef!: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Screenshot: secure_url of an upload signed for purpose payment_proof.',
  })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  proofUrl?: string | null;
}

export class ShipOrderDto {
  @ApiProperty({ example: 'TCS', description: '"self" for your own rider.' })
  @Trim()
  @IsString()
  @Length(2, 80)
  courierName!: string;

  @ApiPropertyOptional({
    example: 'TCS-77120934',
    description: 'Required unless courierName is "self".',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @Length(3, 80)
  trackingRef?: string;

  @ApiPropertyOptional({ description: 'Self-delivery: rider name.' })
  @IsOptional()
  @Trim()
  @IsString()
  @Length(2, 80)
  riderName?: string;

  @ApiPropertyOptional({ description: 'Self-delivery: rider phone.' })
  @IsOptional()
  @IsPkPhone()
  riderPhone?: string;
}

export class RefundDto {
  @ApiProperty({
    example: 4350,
    description: 'Rupees sent back to the customer.',
  })
  @IsInt()
  @Min(1)
  amount!: number;

  @ApiProperty({ example: 'IBFT 99812' })
  @Trim()
  @IsString()
  @Length(3, 100)
  refundRef!: string;
}
