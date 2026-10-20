import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Trim } from '../../../common/validation/transforms';
import { PaginationQueryDto } from '../../../common/pagination/pagination';
import {
  PANTRY_STATUSES,
  PANTRY_UNITS,
  PantryStatus,
  PantryUnit,
} from '../entities/pantry-item.entity';

export class PantryItemDto {
  @ApiProperty({ example: 'Doodh' })
  @Trim()
  @IsString()
  @Length(1, 80)
  name!: string;

  @ApiProperty({ example: 1 })
  @IsNumber()
  @Min(0.001)
  @Max(100000)
  qty!: number;

  @ApiProperty({ enum: PANTRY_UNITS, example: 'l' })
  @IsIn(PANTRY_UNITS)
  unit!: PantryUnit;

  @ApiPropertyOptional({ example: '2026-10-24', nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsISO8601({ strict: true })
  expiresOn?: string | null;

  @IsOptional() @Trim() @IsString() @MaxLength(200) notes?: string;
}

export class PantryBatchDto {
  @ApiProperty({ type: [PantryItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => PantryItemDto)
  items!: PantryItemDto[];
}

export class UpdatePantryItemDto {
  @IsOptional() @Trim() @IsString() @Length(1, 80) name?: string;
  @IsOptional() @IsNumber() @Min(0.001) @Max(100000) qty?: number;
  @ApiPropertyOptional({ enum: PANTRY_UNITS })
  @IsOptional()
  @IsIn(PANTRY_UNITS)
  unit?: PantryUnit;
  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsISO8601({ strict: true })
  expiresOn?: string | null;
  @IsOptional() @Trim() @IsString() @MaxLength(200) notes?: string;
}

export class PantryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PANTRY_STATUSES, default: 'active' })
  @IsOptional()
  @IsIn(PANTRY_STATUSES)
  status?: PantryStatus;
}

export class StatsQueryDto {
  @ApiPropertyOptional({ default: 30, minimum: 7, maximum: 365 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(7)
  @Max(365)
  days: number = 30;
}

class FromOrderLineDto {
  @IsUUID() storeOrderItemId!: string;
  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsISO8601({ strict: true })
  expiresOn?: string | null;
}

export class FromOrdersDto {
  @ApiProperty({ type: [FromOrderLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => FromOrderLineDto)
  lines!: FromOrderLineDto[];
}

class MissingItemDto {
  @Trim() @IsString() @Length(1, 80) name!: string;
}

export class MissingToBagDto {
  @ApiProperty({
    type: [MissingItemDto],
    description: 'A suggestion’s `missing` names.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => MissingItemDto)
  items!: MissingItemDto[];

  @ApiPropertyOptional({ description: 'Default: your default address’s city.' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(80)
  city?: string;
}
