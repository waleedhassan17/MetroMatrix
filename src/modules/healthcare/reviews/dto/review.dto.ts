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
import { Trim } from '../../../../common/validation/transforms';
import { PaginationQueryDto } from '../../../../common/pagination/pagination';
import { REVIEW_TAGS, ReviewTag } from '../entities/doctor-review.entity';

export class CreateReviewDto {
  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  overall!: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 5,
    description: 'Diagnosis and explanation',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  diagnosis?: number;

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
    description: 'Clinic environment (clinic visits only)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  environment?: number;

  @ApiProperty()
  @IsBoolean()
  wouldRecommend!: boolean;

  @ApiPropertyOptional({ enum: REVIEW_TAGS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsIn(REVIEW_TAGS, { each: true })
  tags?: ReviewTag[];

  @ApiPropertyOptional({
    example: 'Listened carefully and explained the treatment.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(1000)
  comment?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  anonymous?: boolean;
}

export const REVIEW_SORTS = ['recent', 'highest', 'lowest'] as const;

export class ReviewQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: REVIEW_SORTS, default: 'recent' })
  @IsOptional()
  @IsIn(REVIEW_SORTS)
  sort?: (typeof REVIEW_SORTS)[number];

  @ApiPropertyOptional({ enum: ['clinic', 'video'] })
  @IsOptional()
  @IsIn(['clinic', 'video'])
  kind?: 'clinic' | 'video';
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
