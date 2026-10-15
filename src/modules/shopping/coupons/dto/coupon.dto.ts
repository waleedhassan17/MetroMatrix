import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../../../common/pagination/pagination';
import { COUPON_TYPES, CouponType } from '../entities/coupon.entity';

export const COUPON_STATES = [
  'active',
  'scheduled',
  'expired',
  'exhausted',
  'inactive',
] as const;
export type CouponState = (typeof COUPON_STATES)[number];

const upper = () =>
  Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  );

export class CreateCouponDto {
  @ApiProperty({
    example: 'EID15',
    description: '3–20 letters, digits or dashes; stored upper-case.',
  })
  @upper()
  @IsString()
  @Matches(/^[A-Z0-9-]{3,20}$/, {
    message: 'code must be 3–20 letters, digits or dashes',
  })
  code!: string;

  @ApiProperty({ enum: COUPON_TYPES })
  @IsIn(COUPON_TYPES)
  type!: CouponType;

  @ApiProperty({ example: 15, description: 'Percent (1–100) or rupees.' })
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  value!: number;

  @ApiPropertyOptional({
    default: 0,
    description: 'Store subtotal needed, rupees.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  minOrder?: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Cap on the discount, rupees.',
  })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  maxDiscount?: number | null;

  @ApiPropertyOptional({ description: 'ISO time; defaults to now.' })
  @IsOptional()
  @IsISO8601({ strict: true })
  startsAt?: string;

  @ApiProperty({ example: '2026-12-31T23:59:59+05:00' })
  @IsISO8601({ strict: true })
  endsAt!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Total uses; null = unlimited.',
  })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  usageLimit?: number | null;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  perUserLimit?: number;
}

/** The code is permanent; type and value are locked once the coupon has been used. */
export class UpdateCouponDto {
  @IsOptional()
  @IsIn(COUPON_TYPES)
  type?: CouponType;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  value?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  minOrder?: number;

  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  maxDiscount?: number | null;

  @IsOptional()
  @IsISO8601({ strict: true })
  startsAt?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  endsAt?: string;

  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  usageLimit?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  perUserLimit?: number;

  @ApiPropertyOptional({
    description: 'true re-activates a deactivated coupon.',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CouponQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: COUPON_STATES })
  @IsOptional()
  @IsIn(COUPON_STATES)
  state?: CouponState;
}
