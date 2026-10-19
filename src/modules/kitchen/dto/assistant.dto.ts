import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Trim } from '../../../common/validation/transforms';
import { RecipeLineDto } from './stock.dto';

export class DescribeDto {
  @IsUUID() itemId!: string;
}

/** POST /food/vendor/kitchen/ai/specials/create — a special's `create.body`, edited or not. */
export class CreateSpecialDto {
  @Trim() @IsString() @Length(2, 120) name!: string;

  @IsOptional() @Trim() @IsString() @MaxLength(1000) description?: string;

  @ApiProperty({ example: 650, description: 'Rupees.' })
  @IsInt()
  @Min(0)
  @Max(500000)
  basePrice!: number;

  @ApiPropertyOptional({ description: 'Default: your first category.' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiProperty({
    minimum: 1,
    maximum: 500,
    description: 'Plates the lines make.',
  })
  @IsInt()
  @Min(1)
  @Max(500)
  servings!: number;

  @ApiProperty({ type: [RecipeLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => RecipeLineDto)
  lines!: RecipeLineDto[];
}

export class PhotoCheckDto {
  @ApiProperty({
    description: 'A menu_item upload of yours (JPG or PNG to be measured).',
  })
  @IsUrl({ protocols: ['https'], require_protocol: true })
  imageUrl!: string;

  @ApiPropertyOptional({
    description: 'The dish it is for (the AI checks it matches).',
  })
  @IsOptional()
  @IsUUID()
  itemId?: string;
}
