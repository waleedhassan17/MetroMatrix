import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Trim } from '../../../../common/validation/transforms';
import { PaginationQueryDto } from '../../../../common/pagination/pagination';

export class DutyDto {
  @ApiProperty()
  @IsBoolean()
  onDuty!: boolean;
}

/** One GPS fix (also the socket `rider.location` payload). */
export class LocationPointDto {
  @ApiPropertyOptional({
    description:
      'The order this fix is for; all your active orders when absent.',
  })
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @ApiProperty({ example: 31.5204 })
  @IsLatitude()
  lat!: number;

  @ApiProperty({ example: 74.3587 })
  @IsLongitude()
  lng!: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 360 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(360)
  heading?: number;

  @ApiPropertyOptional({ description: 'm/s' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  speed?: number;

  @ApiPropertyOptional({ description: 'metres' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000)
  accuracy?: number;

  @ApiPropertyOptional({
    description: 'When the fix was taken; defaults to now.',
  })
  @IsOptional()
  @IsISO8601()
  at?: string;
}

export class LocationBatchDto {
  @ApiProperty({
    type: [LocationPointDto],
    description: 'Fixes buffered while offline, oldest first.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => LocationPointDto)
  points!: LocationPointDto[];
}

export class RiderOrdersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['active', 'history'], default: 'active' })
  @IsOptional()
  @IsIn(['active', 'history'])
  scope?: 'active' | 'history';
}

export class AssignRiderDto {
  @ApiProperty()
  @IsUUID()
  riderId!: string;
}

export class SuggestRidersQueryDto {
  @ApiProperty()
  @IsUUID()
  orderId!: string;
}

export class HandoverDto {
  @ApiProperty({ minimum: 1, example: 1450 })
  @IsInt()
  @Min(1)
  amount!: number;

  @ApiPropertyOptional({ example: 'End of shift' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200)
  note?: string;
}
