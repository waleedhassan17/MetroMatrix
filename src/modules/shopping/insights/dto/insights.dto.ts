import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export const INSIGHT_RANGES = { '7d': 7, '30d': 30, '90d': 90 } as const;
export type InsightRange = keyof typeof INSIGHT_RANGES;

export class InsightsQueryDto {
  @ApiPropertyOptional({ enum: Object.keys(INSIGHT_RANGES), default: '30d' })
  @IsOptional()
  @IsIn(Object.keys(INSIGHT_RANGES))
  range?: InsightRange;
}
