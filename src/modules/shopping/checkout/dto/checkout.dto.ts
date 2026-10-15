import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Trim } from '../../../../common/validation/transforms';

export const PAYMENT_METHODS = ['cod', 'transfer'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export class CheckoutStoreDto {
  @ApiProperty()
  @IsUUID()
  storeId!: string;

  @ApiProperty({ enum: PAYMENT_METHODS })
  @IsIn(PAYMENT_METHODS)
  paymentMethod!: PaymentMethod;

  @ApiPropertyOptional({ nullable: true, example: 'EID15' })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 20)
  couponCode?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'A note for this store.',
  })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

/** POST /shop/checkout and POST /shop/cart/preview. */
export class CheckoutDto {
  @ApiProperty()
  @IsUUID()
  addressId!: string;

  @ApiProperty({
    type: [CheckoutStoreDto],
    description: 'One entry per store in the cart — no more, no fewer.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CheckoutStoreDto)
  stores!: CheckoutStoreDto[];
}
