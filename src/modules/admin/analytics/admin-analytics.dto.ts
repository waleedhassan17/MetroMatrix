import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional } from 'class-validator';

export const OVERVIEW_PERIODS = ['7d', '30d', '90d'] as const;
export type OverviewPeriod = (typeof OVERVIEW_PERIODS)[number];

export const TIMESERIES_METRICS = [
  'signups',
  'businesses_submitted',
  'shopping_orders',
  'shopping_value',
  'health_appointments',
  'food_orders',
  'food_value',
] as const;
export type TimeseriesMetric = (typeof TIMESERIES_METRICS)[number];

export const INTERVALS = ['day', 'week', 'month'] as const;
export type Interval = (typeof INTERVALS)[number];

export class OverviewQueryDto {
  @ApiPropertyOptional({ enum: OVERVIEW_PERIODS, default: '30d' })
  @IsOptional()
  @IsIn([...OVERVIEW_PERIODS])
  period: OverviewPeriod = '30d';
}

export class TimeseriesQueryDto {
  @ApiProperty({ enum: TIMESERIES_METRICS })
  @IsIn([...TIMESERIES_METRICS])
  metric!: TimeseriesMetric;

  @ApiProperty({ format: 'date-time', example: '2026-10-01T00:00:00Z' })
  @IsISO8601()
  from!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-29T00:00:00Z' })
  @IsISO8601()
  to!: string;

  @ApiPropertyOptional({ enum: INTERVALS, default: 'day' })
  @IsOptional()
  @IsIn([...INTERVALS])
  interval: Interval = 'day';
}

class CountByKey {
  @ApiProperty() key!: string;
  @ApiProperty() count!: number;
}

class SignupsView {
  @ApiProperty() last7d!: number;
  @ApiProperty() last30d!: number;
  @ApiProperty() last90d!: number;
}

class BusinessCountView {
  @ApiProperty() serviceType!: string;
  @ApiProperty() status!: string;
  @ApiProperty() count!: number;
}

class ServiceActivityView {
  @ApiProperty({ description: 'Orders or bookings placed in the period.' })
  count!: number;
  @ApiProperty({ description: 'Of those, cancelled, rejected or no-show.' })
  cancelled!: number;
  @ApiProperty({
    description:
      'Recorded value in rupees (not cancelled; completed for appointments). MetroMatrix holds no money.',
  })
  value!: number;
}

class ActivityView {
  @ApiProperty({ type: ServiceActivityView }) shopping!: ServiceActivityView;
  @ApiProperty({ type: ServiceActivityView }) healthcare!: ServiceActivityView;
  @ApiProperty({ type: ServiceActivityView }) food!: ServiceActivityView;
}

class IntegrationsView {
  @ApiProperty() mailConfigured!: boolean;
  @ApiProperty() pushEnabled!: boolean;
  @ApiProperty({ description: 'AI_ENABLED and the ai.enabled setting.' })
  aiEnabled!: boolean;
}

export class OverviewView {
  @ApiProperty({ enum: OVERVIEW_PERIODS }) period!: string;
  @ApiProperty({ format: 'date-time' }) since!: Date;
  @ApiProperty({
    type: [CountByKey],
    description: 'Active and disabled accounts.',
  })
  usersByRole!: CountByKey[];
  @ApiProperty({ type: SignupsView, description: 'Customers and partners.' })
  signups!: SignupsView;
  @ApiProperty({ type: [BusinessCountView] })
  businesses!: BusinessCountView[];
  @ApiProperty() pendingApprovals!: number;
  @ApiProperty({ type: ActivityView }) activity!: ActivityView;
  @ApiProperty({ type: IntegrationsView }) integrations!: IntegrationsView;
}

class TimeseriesPoint {
  @ApiProperty({ format: 'date-time' }) bucket!: string;
  @ApiProperty() value!: number;
}

export class TimeseriesView {
  @ApiProperty({ enum: TIMESERIES_METRICS }) metric!: string;
  @ApiProperty({ enum: INTERVALS }) interval!: string;
  @ApiProperty({ format: 'date-time' }) from!: string;
  @ApiProperty({ format: 'date-time' }) to!: string;
  @ApiProperty({ type: [TimeseriesPoint] }) points!: TimeseriesPoint[];
}
