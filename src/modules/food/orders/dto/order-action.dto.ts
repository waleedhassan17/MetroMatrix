import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Trim } from '../../../../common/validation/transforms';
import { PaginationQueryDto } from '../../../../common/pagination/pagination';
import { FOOD_ORDER_STATUSES } from '../food-order-status';

export class AcceptOrderDto {
  @ApiPropertyOptional({
    minimum: 5,
    maximum: 180,
    description:
      'Minutes until it reaches the customer (pickup: until it is ready). Defaults to the quoted ETA.',
  })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(180)
  etaMinutes?: number;
}

export class ReasonDto {
  @ApiProperty({ example: 'Out of chicken today' })
  @Trim()
  @IsString()
  @Length(3, 300)
  reason!: string;
}

export class OptionalReasonDto {
  @ApiPropertyOptional({ example: 'Ordered by mistake' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class DeliveredDto {
  @ApiPropertyOptional({
    description:
      'Cash taken at the door (COD). Defaults to the order total; never more than it.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  codCollected?: number;
}

export class FoodPaymentProofDto {
  @ApiProperty({ example: 'TXN 8812 3341' })
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

export const VENDOR_ORDER_BUCKETS = ['new', 'active', 'done'] as const;
const VENDOR_STATUS_FILTERS = [
  ...VENDOR_ORDER_BUCKETS,
  ...FOOD_ORDER_STATUSES,
] as const;

export class VendorOrdersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: VENDOR_STATUS_FILTERS,
    description:
      'new = placed · active = accepted…on_the_way · done = ended; or one status.',
  })
  @IsOptional()
  @IsIn(VENDOR_STATUS_FILTERS)
  status?: (typeof VENDOR_STATUS_FILTERS)[number];

  @ApiPropertyOptional({
    enum: ['true', 'false'],
    description: 'Only scheduled (true) or only as-soon-as-possible (false).',
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  scheduled?: 'true' | 'false';
}
