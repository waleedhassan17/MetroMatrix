import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
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
