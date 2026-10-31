import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Trim } from '../../../../common/validation/transforms';
import { PaginationQueryDto } from '../../../../common/pagination/pagination';
import {
  BANNER_TARGETS,
  BannerTarget,
} from '../../catalog/entities/shop-banner.entity';
import {
  REPORT_STATUSES,
  ReportStatus,
} from '../../reports/entities/product-report.entity';
import { ORDER_STATUSES, OrderStatus } from '../../orders/order-status';

export class CreateCategoryDto {
  @ApiProperty({ example: 'Bridal wear' })
  @Trim()
  @IsString()
  @Length(2, 60)
  name!: string;

  @ApiPropertyOptional({
    example: 'women-bridal',
    description: 'Defaults to a slug of the name.',
  })
  @IsOptional()
  @Trim()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must be lower-case words joined by dashes',
  })
  @MaxLength(60)
  slug?: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'A root category; null makes a root.',
  })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @ApiPropertyOptional({ example: 'sparkles' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(40)
  icon?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sort?: number;
}

export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateBannerDto {
  @ApiProperty({
    description: 'secure_url of an upload signed for purpose banner.',
  })
  @IsString()
  @MaxLength(500)
  imageUrl!: string;

  @ApiProperty({ example: 'Eid edit is live' })
  @Trim()
  @IsString()
  @Length(2, 80)
  title!: string;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(140)
  subtitle?: string | null;

  @ApiProperty({ enum: BANNER_TARGETS })
  @IsIn(BANNER_TARGETS)
  targetType!: BannerTarget;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Required unless targetType is none.',
  })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsUUID()
  targetId?: string | null;

  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsISO8601({ strict: true })
  startsAt?: string | null;

  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsISO8601({ strict: true })
  endsAt?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sort?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateBannerDto extends PartialType(CreateBannerDto) {}

export class AdminReportQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: REPORT_STATUSES, default: 'open' })
  @IsOptional()
  @IsIn(REPORT_STATUSES)
  status?: ReportStatus;
}

export class AdminNoteDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString()
  @Length(3, 500)
  note?: string;
}

export class AdminReasonDto {
  @ApiProperty({ example: 'Counterfeit branded goods.' })
  @Trim()
  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class AdminOrderQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Group (MM-XXXXXX) or store-order (MM-XXXXXX-1) code, or a prefix.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(20)
  code?: string;

  @IsOptional()
  @IsUUID()
  storeId?: string;

  @ApiPropertyOptional({ enum: ORDER_STATUSES })
  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: OrderStatus;
}

/** One set of sibling categories (the top level, or one parent's children) in a new order. */
export class ReorderCategoriesDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'The parent whose children these are; null for the top level.',
  })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @ApiProperty({
    description:
      'The categories in their new order (the first shows first); any siblings left out follow.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  ids!: string[];
}

export const ADMIN_STORE_STATES = ['live', 'paused', 'suspended'] as const;

export class AdminStoreQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Store name, slug, city or owner email.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({
    enum: ADMIN_STORE_STATES,
    description:
      'live: approved and open · paused: the store paused itself · suspended: staff suspended the business.',
  })
  @IsOptional()
  @IsIn(ADMIN_STORE_STATES)
  status?: (typeof ADMIN_STORE_STATES)[number];
}
