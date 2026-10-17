import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Trim } from '../../../../common/validation/transforms';
import { FULFILMENTS, Fulfilment } from '../../common/food-types';

export class AddCartItemDto {
  @ApiProperty({ description: 'The vendor (brand) id.' })
  @IsUUID()
  vendorId!: string;

  @ApiProperty()
  @IsUUID()
  itemId!: string;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsUUID()
  variantId?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsUUID('4', { each: true })
  optionIds?: string[];

  @ApiProperty({ minimum: 1, maximum: 50 })
  @IsInt()
  @Min(1)
  @Max(50)
  quantity!: number;

  @ApiPropertyOptional({ nullable: true, example: 'Less spicy please' })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200)
  notes?: string | null;
}

export class AddCartItemQueryDto {
  @ApiPropertyOptional({
    enum: ['true', 'false'],
    description: 'Empty a cart from another vendor first.',
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  replace?: 'true' | 'false';
}

export class UpdateCartItemDto {
  @IsOptional() @IsInt() @Min(1) @Max(50) quantity?: number;

  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsUUID()
  variantId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsUUID('4', { each: true })
  optionIds?: string[];

  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200)
  notes?: string | null;
}

export class PatchCartDto {
  @ApiPropertyOptional({ enum: FULFILMENTS })
  @IsOptional()
  @IsIn(FULFILMENTS)
  fulfilment?: Fulfilment;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Schedule for later (a pre-order slot start for home kitchens with slots); null = as soon as possible.',
  })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsISO8601()
  scheduledFor?: string | null;
}
