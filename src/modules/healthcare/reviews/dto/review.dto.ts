import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Trim } from '../../../../common/validation/transforms';
import { PaginationQueryDto } from '../../../../common/pagination/pagination';
import { REVIEW_TAGS, ReviewTag } from '../entities/doctor-review.entity';

export class CreateReviewDto {
  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  overall!: number;

  @ApiProperty({
    minimum: 1,
    maximum: 5,
    description: 'Diagnosis and explanation',
  })
  @IsInt()
  @Min(1)
  @Max(5)
  diagnosis!: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 5,
    description: 'Staff behaviour',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  staff?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 5,
    description: 'Clinic environment (clinic visits only; ignored for video)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  environment?: number;

  @ApiProperty({ description: 'Would you recommend this doctor?' })
  @IsBoolean()
  recommend!: boolean;

  @ApiPropertyOptional({ enum: REVIEW_TAGS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsIn(REVIEW_TAGS, { each: true })
  tags?: ReviewTag[];

  @ApiPropertyOptional({
    example: 'Listened carefully and explained the treatment.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(1000)
  text?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Shown with initials only.',
  })
  @IsOptional()
  @IsBoolean()
  isAnonymous?: boolean;
}

export const REVIEW_SORTS = ['latest', 'highest', 'lowest'] as const;

export class ReviewQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: REVIEW_SORTS, default: 'latest' })
  @IsOptional()
  @IsIn(REVIEW_SORTS)
  sort?: (typeof REVIEW_SORTS)[number];

  @ApiPropertyOptional({ enum: ['clinic', 'video'] })
  @IsOptional()
  @IsIn(['clinic', 'video'])
  kind?: 'clinic' | 'video';

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 5,
    description: 'Only reviews with this many stars.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({
    enum: ['true', 'false'],
    description: 'Doctor list only: reviews you have not replied to.',
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  unreplied?: 'true' | 'false';
}

export class ReplyDto {
  @ApiProperty({ example: 'Thank you — glad the treatment is helping.' })
  @Trim()
  @IsString()
  @Length(2, 1000)
  text!: string;
}

export class AdminReviewQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  doctorId?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  hidden?: 'true' | 'false';
}

export class HideReviewDto {
  @ApiProperty({ example: 'Contains a phone number.' })
  @Trim()
  @IsString()
  @Length(3, 500)
  reason!: string;
}
