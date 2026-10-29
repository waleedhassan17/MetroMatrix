import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RequireStepUp } from '../../common/decorators/require-step-up.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { ApiEnvelopeOk, ApiPagedOk } from '../../common/swagger/api-envelope';
import { BroadcastsService } from './broadcasts.service';
import { BroadcastView, CreateBroadcastDto } from './broadcasts.dto';

@ApiTags('admin: broadcasts')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@RequirePermission('broadcast')
@Controller('admin/broadcasts')
export class BroadcastsController {
  constructor(private readonly broadcasts: BroadcastsService) {}

  @Post()
  @RequireStepUp()
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @ApiOperation({
    summary:
      'Push to an audience. 201 with the broadcast (status queued); delivery follows in batches. 503 PUSH_DISABLED when push is off. Step-up.',
  })
  @ApiEnvelopeOk(BroadcastView, { status: 201 })
  create(
    @CurrentUser() me: AuthenticatedUser,
    @Body() dto: CreateBroadcastDto,
  ) {
    return this.broadcasts.create(me.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'History, newest first, with delivery counts.' })
  @ApiPagedOk(BroadcastView)
  list(@Query() q: PaginationQueryDto) {
    return this.broadcasts.list(q);
  }
}
