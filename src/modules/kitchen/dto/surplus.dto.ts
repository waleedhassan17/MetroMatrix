import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Trim } from '../../../common/validation/transforms';

export class SurplusBoxDto {
  @ApiProperty({ example: 'Bachat Box — dinner mix' })
  @Trim()
  @IsString()
  @Length(3, 80)
  title!: string;
  @IsOptional() @Trim() @IsString() @MaxLength(300) description?: string;

  @ApiPropertyOptional({ example: 'Usually biryani, a curry and naan' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200)
  contentsHint?: string;

  @ApiProperty({
    example: 1200,
    description: 'What it would cost on the menu (rupees).',
  })
  @IsInt()
  @Min(1)
  @Max(100000)
  originalValue!: number;

  @ApiProperty({ example: 450, description: '≤ originalValue.' })
  @IsInt()
  @Min(0)
  @Max(100000)
  price!: number;
  @ApiProperty({ example: 5 }) @IsInt() @Min(1) @Max(200) quantity!: number;
  @ApiProperty() @IsISO8601() pickupFrom!: string;
  @ApiProperty({ description: 'Same day as pickupFrom, in the future.' })
  @IsISO8601()
  pickupTo!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @Matches(/^[a-z][a-z_]{1,19}$/, { each: true })
  tags?: string[];
}

export class UpdateSurplusBoxDto {
  @IsOptional() @Trim() @IsString() @Length(3, 80) title?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(200) contentsHint?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100000) price?: number;

  @ApiPropertyOptional({ description: 'At least what is already reserved.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  quantity?: number;

  @IsOptional() @IsISO8601() pickupTo?: string;
}

export class SurplusQueryDto {
  @Type(() => Number) @IsNumber() @Min(-90) @Max(90) lat!: number;
  @Type(() => Number) @IsNumber() @Min(-180) @Max(180) lng!: number;

  @ApiPropertyOptional({ default: 8 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(25)
  radiusKm?: number;
}

export class ReserveDto {
  @ApiProperty({ minimum: 1, maximum: 10 })
  @IsInt()
  @Min(1)
  @Max(10)
  quantity!: number;

  @ApiPropertyOptional({
    enum: ['pay_at_pickup', 'transfer'],
    default: 'pay_at_pickup',
  })
  @IsOptional()
  @IsIn(['pay_at_pickup', 'transfer'])
  paymentMethod?: 'pay_at_pickup' | 'transfer';
}

export class CollectDto {
  @ApiPropertyOptional({
    description: 'The customer’s code (BB-XXXXXX), checked when given.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(12)
  code?: string;
}

export class ReservationsQueryDto {
  @IsOptional() @IsUUID() boxId?: string;
  @IsOptional()
  @IsIn(['reserved', 'collected', 'no_show', 'cancelled'])
  status?: string;
}

export class DonationDto {
  @ApiProperty({ example: 'Edhi Foundation, Gulberg' })
  @Trim()
  @IsString()
  @Length(2, 120)
  organisation!: string;
  @ApiProperty({ example: 25 }) @IsInt() @Min(1) @Max(10000) meals!: number;
  @IsOptional() @Trim() @IsString() @MaxLength(300) notes?: string;

  @ApiPropertyOptional({ description: 'A `kitchen_story` upload of yours.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  photoUrl?: string;
}

export class PackingProofDto {
  @ApiProperty({ description: 'A `packing_proof` upload of yours.' })
  @IsString()
  @MaxLength(500)
  photoUrl!: string;
  @IsOptional() @IsString() @MaxLength(300) publicId?: string;
}
