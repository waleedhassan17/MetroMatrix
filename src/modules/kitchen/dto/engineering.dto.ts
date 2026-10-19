import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Trim } from '../../../common/validation/transforms';
import { PaginationQueryDto } from '../../../common/pagination/pagination';

/** POST /food/vendor/kitchen/experiments */
export class ExperimentDto {
  @IsUUID() itemId!: string;

  @ApiProperty({ minimum: 3, maximum: 60, example: 14 })
  @Type(() => Number)
  @IsInt()
  @Min(3)
  @Max(60)
  days!: number;

  @ApiPropertyOptional({ description: 'Default today (the kitchen’s date).' })
  @IsOptional()
  @IsISO8601({ strict: true })
  startsOn?: string;

  @ApiPropertyOptional({ example: 'New recipe with less oil' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(300)
  notes?: string;
}

export class UpdateExperimentDto {
  @ApiPropertyOptional({
    description: 'Move the last day (not before the start).',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  endsOn?: string;

  @IsOptional() @Trim() @IsString() @MaxLength(300) notes?: string;
}

export class ExperimentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: ['planned', 'running', 'completed', 'cancelled'],
  })
  @IsOptional()
  @IsIn(['planned', 'running', 'completed', 'cancelled'])
  status?: 'planned' | 'running' | 'completed' | 'cancelled';
}
