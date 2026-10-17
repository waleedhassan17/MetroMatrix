import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
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
import {
  FOOD_REVIEW_TAGS,
  FoodReviewTag,
} from '../entities/food-review.entity';

export class FoodReviewDto {
  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  foodRating!: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 5,
    description: 'Delivery orders only.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  deliveryRating?: number;

  @ApiPropertyOptional({ enum: FOOD_REVIEW_TAGS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(FOOD_REVIEW_TAGS.length)
  @IsIn(FOOD_REVIEW_TAGS, { each: true })
  tags?: FoodReviewTag[];

  @ApiPropertyOptional({ example: 'Karahi was hot and the naan fresh.' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(1000)
  text?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'secure_urls of uploads signed for purpose review_photo.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  photos?: string[];
}

export class ReplyDto {
  @ApiProperty({ example: 'Thank you! See you again.' })
  @Trim()
  @IsString()
  @Length(2, 1000)
  reply!: string;
}

export class VendorReviewsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  unreplied?: 'true' | 'false';
}

export class AdminFoodReviewsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  hidden?: 'true' | 'false';

  @ApiPropertyOptional({ description: 'Complaints: food rating at most this.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  maxRating?: number;
}

export class HideReviewDto {
  @ApiProperty({ example: 'Personal details in the text' })
  @Trim()
  @IsString()
  @Length(3, 300)
  reason!: string;
}
