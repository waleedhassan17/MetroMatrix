import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { ApiEnvelopeOk } from '../../../common/swagger/api-envelope';
import { AdminAnalyticsService } from './admin-analytics.service';
import {
  OverviewQueryDto,
  OverviewView,
  TimeseriesQueryDto,
  TimeseriesView,
} from './admin-analytics.dto';

@ApiTags('admin: analytics')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@RequirePermission('viewAnalytics')
@Controller('admin')
export class AdminAnalyticsController {
  constructor(private readonly analytics: AdminAnalyticsService) {}

  @Get('overview')
  @ApiOperation({
    summary:
      'Users by role, signups, businesses, pending approvals, per-service activity and integration status.',
  })
  @ApiEnvelopeOk(OverviewView)
  overview(@Query() q: OverviewQueryDto) {
    return this.analytics.overview(q.period);
  }

  @Get('analytics/timeseries')
  @ApiOperation({
    summary:
      '?metric&from&to&interval=day|week|month — every bucket in UTC, empty ones as 0.',
  })
  @ApiEnvelopeOk(TimeseriesView)
  timeseries(@Query() q: TimeseriesQueryDto) {
    return this.analytics.timeseries(q.metric, q.from, q.to, q.interval);
  }
}
