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
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Trim } from '../../../../common/validation/transforms';
import {
  HEALTH_BANNER_SCREENS,
  HEALTH_BANNER_TARGETS,
  HealthBannerScreen,
  HealthBannerTarget,
} from '../../discovery/entities/health-banner.entity';

export class HealthBannerDto {
  @ApiProperty({
    description: 'secure_url of an upload signed for purpose banner.',
  })
  @IsString()
  @MaxLength(500)
  imageUrl!: string;

  @ApiProperty({ example: 'See a doctor by video today' })
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

  @ApiProperty({ enum: HEALTH_BANNER_TARGETS })
  @IsIn(HEALTH_BANNER_TARGETS)
  targetType!: HealthBannerTarget;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'The specialty, condition or doctor id (those target types only).',
  })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsUUID()
  targetId?: string | null;

  @ApiPropertyOptional({
    enum: HEALTH_BANNER_SCREENS,
    nullable: true,
    description: 'The app screen (targetType screen only).',
  })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsIn(HEALTH_BANNER_SCREENS)
  targetScreen?: HealthBannerScreen | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Show only in this city; null shows it everywhere.',
  })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @Trim()
  @IsString()
  @Length(2, 80)
  city?: string | null;

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

export class UpdateHealthBannerDto extends PartialType(HealthBannerDto) {}

export class ReorderHealthBannersDto {
  @ApiProperty({
    description: 'Banner ids in their new order (the first shows first).',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  ids!: string[];
}
