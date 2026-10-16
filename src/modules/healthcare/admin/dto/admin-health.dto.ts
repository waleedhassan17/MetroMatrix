import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';
import { Trim } from '../../../../common/validation/transforms';
import { PaginationQueryDto } from '../../../../common/pagination/pagination';

export class AdminDoctorQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['verified', 'unverified'] })
  @IsOptional()
  @IsIn(['verified', 'unverified'])
  pmdc?: 'verified' | 'unverified';

  @IsOptional()
  @IsUUID()
  businessId?: string;

  @ApiPropertyOptional({ description: 'Name or PMDC number.' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(60)
  q?: string;
}

export class AdminNoteDto {
  @IsOptional()
  @Trim()
  @IsString()
  @Length(3, 500)
  note?: string;
}

export class AdminReasonDto {
  @ApiProperty({ example: 'PMDC registration lapsed.' })
  @Trim()
  @IsString()
  @Length(3, 500)
  reason!: string;
}
