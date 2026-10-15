import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDefined,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsPkPhone } from '../../../common/validation/phone';
import { Trim } from '../../../common/validation/transforms';
import { ADDRESS_LABELS, AddressLabel } from '../entities/address.entity';

export class CreateAddressDto {
  @ApiPropertyOptional({ enum: ADDRESS_LABELS, default: 'home' })
  @IsOptional()
  @IsIn([...ADDRESS_LABELS])
  label?: AddressLabel;

  @ApiProperty({ example: 'Ayesha Khan' })
  @Trim()
  @IsString()
  @Length(2, 80)
  fullName!: string;

  @ApiProperty({
    example: '0312 4890176',
    description: 'Pakistani mobile; stored +923XXXXXXXXX.',
  })
  @IsDefined({ message: 'phone is required' })
  @IsPkPhone()
  phone!: string;

  @ApiProperty({ example: 'Lahore' })
  @Trim()
  @IsString()
  @Length(2, 60)
  city!: string;

  @ApiProperty({ example: 'Gulberg III' })
  @Trim()
  @IsString()
  @Length(2, 100)
  area!: string;

  @ApiProperty({ example: 'House 12, Street 4' })
  @Trim()
  @IsString()
  @Length(3, 255)
  line1!: string;

  @ApiPropertyOptional({ example: 'Near Liberty Market' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(255)
  landmark?: string;

  @ApiPropertyOptional({ example: 31.5204 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-90)
  @Max(90)
  lat?: number;

  @ApiPropertyOptional({ example: 74.3587 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-180)
  @Max(180)
  lng?: number;

  @ApiPropertyOptional({ description: 'Make this the default address.' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateAddressDto extends PartialType(CreateAddressDto) {}
