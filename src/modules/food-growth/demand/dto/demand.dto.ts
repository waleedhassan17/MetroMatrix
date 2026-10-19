import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { Trim } from '../../../../common/validation/transforms';

export class DemandMapQueryDto {
  @ApiPropertyOptional({ description: 'One cuisine’s searches only.' })
  @IsOptional()
  @IsUUID()
  cuisineId?: string;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: 23,
    description: 'One hour (Pakistan time).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(23)
  hour?: number;

  @ApiPropertyOptional({
    description: 'A week (its Monday); default the latest.',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  week?: string;
}

export class AdminDemandMapQueryDto extends DemandMapQueryDto {
  @ApiProperty({ example: 'Lahore' })
  @Trim()
  @IsString()
  @Length(2, 80)
  city!: string;
}

export class DemandCurveQueryDto {
  @ApiPropertyOptional({ default: 8, minimum: 4, maximum: 26 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(4)
  @Max(26)
  weeks: number = 8;
}
