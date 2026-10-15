import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Trim } from '../../../../common/validation/transforms';
import { PaginationQueryDto } from '../../../../common/pagination/pagination';

export class InventoryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Only active variants at ≤ 3 in stock.' })
  @IsOptional()
  @IsIn(['true', 'false'])
  lowStock?: 'true' | 'false';

  @ApiPropertyOptional({ description: 'Matches product name or SKU.' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class AdjustStockDto {
  @ApiPropertyOptional({
    example: -2,
    description: 'Relative change. Send this or setTo.',
  })
  @IsOptional()
  @IsInt()
  @Min(-100_000)
  @Max(100_000)
  delta?: number;

  @ApiPropertyOptional({
    example: 25,
    description: 'Absolute new stock. Send this or delta.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  setTo?: number;
}

export class BulkStockRowDto {
  @ApiProperty()
  @IsUUID()
  variantId!: string;

  @ApiProperty({ example: 12 })
  @IsInt()
  @Min(0)
  @Max(100_000)
  setTo!: number;
}
