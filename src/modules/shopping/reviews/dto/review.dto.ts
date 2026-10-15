import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Trim } from '../../../../common/validation/transforms';
import { PaginationQueryDto } from '../../../../common/pagination/pagination';

export const MAX_REVIEW_PHOTOS = 5;

export class CreateReviewDto {
  @ApiProperty({ minimum: 1, maximum: 5, example: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @ApiPropertyOptional({ example: 'Beautiful embroidery, true to size.' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(2000)
  text?: string;

  @ApiPropertyOptional({
    type: [String],
    description: `Up to ${MAX_REVIEW_PHOTOS} secure_urls of uploads signed for purpose review_photo.`,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_REVIEW_PHOTOS)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  photos?: string[];
}

export class ProductReviewQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({ description: 'Only reviews with photos.' })
  @IsOptional()
  @IsIn(['true', 'false'])
  withPhotos?: 'true' | 'false';
}

export class PartnerReviewQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({ description: 'Only reviews you have not replied to.' })
  @IsOptional()
  @IsIn(['true', 'false'])
  unreplied?: 'true' | 'false';
}

export class ReplyDto {
  @ApiProperty({ example: 'Thank you! Enjoy your kurta.' })
  @Trim()
  @IsString()
  @Length(2, 1000)
  text!: string;
}
