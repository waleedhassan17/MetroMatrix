import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Trim } from '../../../../common/validation/transforms';
import {
  REPORT_REASONS,
  ReportReason,
} from '../entities/product-report.entity';

export class CreateReportDto {
  @ApiProperty({ enum: REPORT_REASONS })
  @IsIn(REPORT_REASONS)
  reason!: ReportReason;

  @ApiPropertyOptional({ example: 'The logo is a copy of a known brand.' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(1000)
  details?: string;
}
