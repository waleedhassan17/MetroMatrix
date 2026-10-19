import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
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
import { QtyDto } from './stock.dto';
import { WASTE_REASONS, WasteReason } from '../entities/waste-entry.entity';

export class SupplierDto {
  @ApiProperty({ example: 'Akbari Mandi — Ashraf' })
  @Trim()
  @IsString()
  @Length(2, 80)
  name!: string;
  @IsOptional() @Trim() @IsString() @Length(5, 20) phone?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(500) notes?: string;
}

export class UpdateSupplierDto {
  @IsOptional() @Trim() @IsString() @Length(2, 80) name?: string;
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @Trim()
  @IsString()
  @Length(5, 20)
  phone?: string | null;
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class PurchaseLineDto extends QtyDto {
  @IsUUID() ingredientId!: string;

  @ApiProperty({ example: 1200, description: 'Rupees for this line.' })
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  totalPrice!: number;

  @IsOptional() @IsISO8601({ strict: true }) expiresOn?: string;
}

export class PurchaseDto {
  @IsOptional() @IsUUID() supplierId?: string;

  @ApiPropertyOptional({ description: 'Defaults to now.' })
  @IsOptional()
  @IsISO8601()
  purchasedAt?: string;

  @ApiPropertyOptional({ description: 'A `receipt` upload of yours.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  receiptUrl?: string;

  @IsOptional() @IsString() @MaxLength(300) receiptPublicId?: string;

  @ApiPropertyOptional({
    enum: ['manual', 'voice', 'receipt_scan'],
    default: 'manual',
  })
  @IsOptional()
  @IsIn(['manual', 'voice', 'receipt_scan'])
  source?: 'manual' | 'voice' | 'receipt_scan';

  @IsOptional() @Trim() @IsString() @MaxLength(300) note?: string;

  @ApiProperty({ type: [PurchaseLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineDto)
  lines!: PurchaseLineDto[];
}

export class UpdatePurchaseDto {
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsUUID() supplierId?:
    string | null;
  @IsOptional() @IsISO8601() purchasedAt?: string;
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

export class PurchasesQueryDto extends PaginationQueryDto {
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @IsUUID() ingredientId?: string;
  @IsOptional() @IsISO8601({ strict: true }) from?: string;
  @IsOptional() @IsISO8601({ strict: true }) to?: string;
}

export class ScanDto {
  @ApiProperty({
    description: 'A `receipt` upload of yours (POST /media/sign-upload).',
  })
  @IsString()
  @MaxLength(500)
  imageUrl!: string;

  @IsOptional() @IsString() @MaxLength(300) publicId?: string;
}

export class WasteDto {
  @ApiPropertyOptional({
    description: 'An ingredient… (give this or menuItemId)',
  })
  @ValidateIf((o: WasteDto) => !o.menuItemId)
  @IsUUID()
  ingredientId?: string;

  @ApiPropertyOptional({
    description: '…or cooked portions of a dish (unit "serving").',
  })
  @ValidateIf((o: WasteDto) => !o.ingredientId)
  @IsUUID()
  menuItemId?: string;

  @ApiProperty({ example: 2 })
  @IsNumber()
  @Min(0.001)
  @Max(1_000_000)
  qty!: number;
  @ApiProperty({ example: 'kg', description: 'For a dish: serving.' })
  @Trim()
  @IsString()
  @Length(1, 20)
  unit!: string;
  @ApiProperty({ enum: WASTE_REASONS })
  @IsIn(WASTE_REASONS)
  reason!: WasteReason;
  @IsOptional() @Trim() @IsString() @MaxLength(300) note?: string;
}

export class WasteQueryDto extends PaginationQueryDto {
  @IsOptional() @IsIn(WASTE_REASONS) reason?: WasteReason;
  @IsOptional() @IsISO8601({ strict: true }) from?: string;
  @IsOptional() @IsISO8601({ strict: true }) to?: string;
}

export class WasteSummaryQueryDto {
  @ApiPropertyOptional({ enum: ['7d', '30d', '90d'], default: '7d' })
  @IsOptional()
  @IsIn(['7d', '30d', '90d'])
  range?: '7d' | '30d' | '90d';
}

export class KitchenSettingsDto {
  @ApiPropertyOptional({ minimum: 5, maximum: 95, description: 'Default 35.' })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(95)
  targetFoodCostPct?: number;

  @ApiPropertyOptional({
    description: 'A packing photo before an order leaves.',
  })
  @IsOptional()
  @IsBoolean()
  requirePackingPhoto?: boolean;
}

export class IngredientMappingDto {
  @ApiPropertyOptional({
    nullable: true,
    description:
      'The PBS SPI item to compare with (GET /price-watch/reference-items).',
  })
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  referenceItemId!: string | null;
}

export class ReferenceImportDto {
  @ApiProperty({
    description:
      'CSV, header week_ending,city,item,unit,price — one row per item, city and week (≤ 512 KB).',
    example:
      'week_ending,city,item,unit,price\n2026-10-15,Lahore,Tomatoes,kg,180',
  })
  @IsString()
  @Length(20, 524_288)
  csv!: string;
}
