import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Trim } from '../../../../common/validation/transforms';
import { PaginationQueryDto } from '../../../../common/pagination/pagination';
import { HYGIENE_METHODS } from '../entities/kitchen-story.entity';

export class HygieneChecklistDto {
  @IsBoolean() gloves!: boolean;
  @IsBoolean() hairnet!: boolean;
  @IsBoolean() cleanWater!: boolean;
  @ApiProperty({ description: 'Separate boards for raw and cooked food.' })
  @IsBoolean()
  separateBoards!: boolean;
  @ApiProperty({ description: 'A fridge temperature log is kept.' })
  @IsBoolean()
  fridgeTempLog!: boolean;
  @ApiPropertyOptional({ nullable: true, example: '2026-09-15' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsISO8601({ strict: true })
  pestControlOn?: string | null;
}

/** PUT /food/vendor/story — the whole story (omitted fields are cleared). */
export class KitchenStoryDto {
  @ApiPropertyOptional({ nullable: true, maxLength: 2000 })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Trim()
  @IsString()
  @MaxLength(2000)
  story?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Ammi Jaan' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Trim()
  @IsString()
  @Length(2, 80)
  cookName?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'A `kitchen_video` upload of yours.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUrl({ protocols: ['https'], require_protocol: true })
  videoUrl?: string | null;

  @ApiPropertyOptional({
    type: [String],
    description: 'Up to 6 `kitchen_story` uploads of yours.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsUrl({ protocols: ['https'], require_protocol: true }, { each: true })
  photos?: string[];

  @ApiPropertyOptional({ type: HygieneChecklistDto, nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @ValidateNested()
  @Type(() => HygieneChecklistDto)
  hygieneChecklist?: HygieneChecklistDto | null;
}

export class HygieneQueueQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: ['self_declared', 'verified'],
    default: 'self_declared',
    description: 'self_declared = waiting for verification.',
  })
  @IsOptional()
  @IsIn(['self_declared', 'verified'])
  status?: 'self_declared' | 'verified';
}

export class HygieneVerifyDto {
  @ApiProperty({ enum: HYGIENE_METHODS })
  @IsIn(HYGIENE_METHODS)
  method!: (typeof HYGIENE_METHODS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class ReasonDto {
  @Trim() @IsString() @Length(3, 300) reason!: string;
}

export class SignatureQueueQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: ['claimed', 'removed'],
    default: 'claimed',
  })
  @IsOptional()
  @IsIn(['claimed', 'removed'])
  status?: 'claimed' | 'removed';
}
