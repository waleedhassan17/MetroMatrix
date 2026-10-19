import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Trim } from '../../../../common/validation/transforms';
import {
  FOOD_PAYMENT_METHODS,
  CustomerPaymentMethod as FoodPaymentMethod,
} from '../../common/food-types';

/** What both preview and checkout take, apart from the payment method. */
class OrderDetailsDto {
  @ApiPropertyOptional({
    description: 'Delivery: a saved address with a map pin.',
  })
  @IsOptional()
  @IsUUID()
  addressId?: string;

  @ApiPropertyOptional({ nullable: true, example: 'KARAHI20' })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 20)
  promoCode?: string | null;

  @ApiPropertyOptional({ description: 'Send cutlery (default no).' })
  @IsOptional()
  @IsBoolean()
  cutlery?: boolean;

  @ApiPropertyOptional({ example: 'Ring the bell twice' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(300)
  note?: string;

  @ApiPropertyOptional({ example: 'Askari Tower 2' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(80)
  building?: string;

  @ApiPropertyOptional({ example: '3rd floor' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(30)
  floor?: string;

  @ApiPropertyOptional({ example: 'Call when you reach the gate' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200)
  riderInstructions?: string;
}

/** POST /food/cart/preview */
export class FoodPreviewDto extends OrderDetailsDto {
  @ApiPropertyOptional({ enum: FOOD_PAYMENT_METHODS })
  @IsOptional()
  @IsIn(FOOD_PAYMENT_METHODS)
  paymentMethod?: FoodPaymentMethod;
}

/** POST /food/checkout */
export class FoodCheckoutDto extends OrderDetailsDto {
  @ApiProperty({ enum: FOOD_PAYMENT_METHODS })
  @IsIn(FOOD_PAYMENT_METHODS)
  paymentMethod!: FoodPaymentMethod;
}
