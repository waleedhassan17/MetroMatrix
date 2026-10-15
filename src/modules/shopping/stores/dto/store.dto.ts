import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
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
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Trim } from '../../../../common/validation/transforms';
import { HEX_COLOR } from '../../common/contrast';
import {
  PAYMENT_ACCOUNT_KINDS,
  PaymentAccountKind,
} from '../../../../common/payments/payment-account.validation';

export class StoreSocialsDto {
  @IsOptional() @Trim() @IsString() @MaxLength(200) instagram?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(200) facebook?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(200) tiktok?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(200) website?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(20) whatsapp?: string;
}

export class UpdateStoreProfileDto {
  @ApiPropertyOptional({ nullable: true, maxLength: 120 })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(120)
  tagline?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 2000 })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(2000)
  about?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'From an upload signed for purpose store_branding.',
  })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'From an upload signed for purpose store_branding.',
  })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  coverUrl?: string | null;

  @ApiPropertyOptional({
    example: '#BE123C',
    description:
      'Must reach WCAG AA (4.5:1) against white or ink; onBrandColor is derived.',
  })
  @IsOptional()
  @Matches(HEX_COLOR, { message: 'brandColor must be a #RRGGBB hex colour' })
  brandColor?: string;

  @ApiPropertyOptional({ type: StoreSocialsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => StoreSocialsDto)
  socials?: StoreSocialsDto;
}

export class UpdateStoreSettingsDto {
  @ApiPropertyOptional({
    minimum: 0,
    maximum: 30,
    description: 'Days after delivery a return may be requested.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  returnWindowDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  codEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Highest store-order total (rupees) accepted as COD.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  codLimit?: number;

  @ApiPropertyOptional({ description: 'Flat shipping per order, rupees.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  shippingFlatFee?: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Subtotal from which shipping is free; null = never.',
  })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  freeShippingOver?: number | null;

  @ApiPropertyOptional({
    type: [String],
    description: 'Cities you deliver to; empty = nationwide.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @IsString({ each: true })
  @Length(2, 60, { each: true })
  deliveryCities?: string[];

  @ApiPropertyOptional({ minimum: 0, maximum: 30 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  dispatchDaysMin?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 60 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  dispatchDaysMax?: number;

  @ApiPropertyOptional({
    description: 'Hide the store from customers temporarily.',
  })
  @IsOptional()
  @IsBoolean()
  isPaused?: boolean;

  @ApiPropertyOptional({ nullable: true, maxLength: 200 })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200)
  pauseMessage?: string | null;
}

export class CreatePaymentAccountDto {
  @ApiProperty({ enum: PAYMENT_ACCOUNT_KINDS })
  @IsIn([...PAYMENT_ACCOUNT_KINDS])
  kind!: PaymentAccountKind;

  @ApiProperty({ example: 'Hafeez General Store' })
  @Trim()
  @IsString()
  @Length(2, 80)
  accountTitle!: string;

  @ApiProperty({
    example: 'PK36 MEZN 0001 2345 6789 0123',
    description: 'IBAN for bank; the mobile number otherwise.',
  })
  @IsString()
  @Length(4, 40)
  accountNumber!: string;

  @ApiPropertyOptional({
    example: 'Meezan Bank',
    description: 'Required for bank accounts.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @Length(2, 80)
  bankName?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePaymentAccountDto extends PartialType(
  CreatePaymentAccountDto,
) {}

export class CreateCollectionDto {
  @ApiProperty({ example: 'Eid edit' })
  @Trim()
  @IsString()
  @Length(2, 60)
  name!: string;
}

export class UpdateCollectionDto extends PartialType(CreateCollectionDto) {}

export class ReorderCollectionsDto {
  @ApiProperty({
    type: [String],
    description: 'Collection ids in the new order.',
  })
  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  ids!: string[];
}
