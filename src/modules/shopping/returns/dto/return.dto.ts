import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
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
  ValidateNested,
} from 'class-validator';
import { Trim } from '../../../../common/validation/transforms';
import { PaginationQueryDto } from '../../../../common/pagination/pagination';
import {
  RETURN_REASONS,
  RETURN_STATUSES,
  ReturnReason,
  ReturnStatus,
} from '../return-status';

export const MAX_RETURN_PHOTOS = 5;

export class ReturnItemDto {
  @ApiProperty({ description: 'A line of this store order.' })
  @IsUUID()
  orderItemId!: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  @Max(20)
  quantity!: number;
}

export class CreateReturnDto {
  @ApiProperty({ type: [ReturnItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ReturnItemDto)
  items!: ReturnItemDto[];

  @ApiProperty({ enum: RETURN_REASONS })
  @IsIn(RETURN_REASONS)
  reason!: ReturnReason;

  @ApiPropertyOptional({ example: 'The stitching came apart on first wash.' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(2000)
  details?: string;

  @ApiPropertyOptional({
    type: [String],
    description: `Up to ${MAX_RETURN_PHOTOS} secure_urls of uploads signed for purpose return_photo.`,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_RETURN_PHOTOS)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  photos?: string[];
}

export class ReturnQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: RETURN_STATUSES })
  @IsOptional()
  @IsIn(RETURN_STATUSES)
  status?: ReturnStatus;
}

export class ApproveReturnDto {
  @ApiPropertyOptional({ example: 'Please send it with the original tags.' })
  @IsOptional()
  @Trim()
  @IsString()
  @Length(3, 500)
  note?: string;
}

export class RejectReturnDto {
  @ApiProperty({ example: 'Worn and washed — not eligible.' })
  @Trim()
  @IsString()
  @Length(3, 500)
  note!: string;
}

export class ReceiveItemDto {
  @ApiProperty()
  @IsUUID()
  returnItemId!: string;

  @ApiProperty({ description: 'Put this line back into sellable stock?' })
  @IsBoolean()
  restock!: boolean;
}

export class ReceiveReturnDto {
  @ApiPropertyOptional({
    type: [ReceiveItemDto],
    description:
      'Restock flags per returned line; lines not listed are not restocked.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ReceiveItemDto)
  items?: ReceiveItemDto[];
}

export class ReturnRefundDto {
  @ApiProperty({
    example: 3900,
    description:
      'Rupees refunded (off-platform); at most the returned lines’ value.',
  })
  @IsInt()
  @Min(1)
  amount!: number;

  @ApiProperty({ example: 'IBFT 55120' })
  @Trim()
  @IsString()
  @Length(3, 100)
  refundRef!: string;
}
