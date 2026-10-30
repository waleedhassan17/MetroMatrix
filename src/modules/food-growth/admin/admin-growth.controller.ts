import {
  AdminGrowthCreateEventView,
  AdminGrowthDemandCitiesView,
  AdminGrowthDemandMapView,
  AdminGrowthEventsView,
  AdminGrowthHygieneView,
  AdminGrowthLookupView,
  AdminGrowthRemoveEventView,
  AdminGrowthRemoveSignatureView,
  AdminGrowthRevokeView,
  AdminGrowthSignaturesView,
  AdminGrowthUpdateEventView,
  AdminGrowthVerifyView,
} from './admin-growth.response';
import {
  ApiEnvelopeOk,
  ApiPagedOk,
} from '../../../common/swagger/api-envelope';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import {
  CalendarEventDto,
  CalendarEventsQueryDto,
  UpdateCalendarEventDto,
} from '../ramadan/dto/ramadan.dto';
import {
  HygieneQueueQueryDto,
  HygieneVerifyDto,
  SignatureReasonDto,
  SignatureQueueQueryDto,
} from '../story/dto/story.dto';
import { RamadanService } from '../ramadan/ramadan.service';
import { StoryService } from '../story/story.service';
import { DemandService } from '../demand/demand.service';
import { GrowthLookupService } from './growth-lookup.service';
import { AdminDemandMapQueryDto } from '../demand/dto/demand.dto';

/** Staff: the calendar, hygiene verification, signature moderation (P7) and the demand map (P8). Every write is audited. */
@ApiTags('admin · food growth')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@RequirePermission('manageFood')
@Controller('admin/food')
export class AdminGrowthController {
  constructor(
    private readonly ramadan: RamadanService,
    private readonly stories: StoryService,
    private readonly demand: DemandService,
    private readonly lookups: GrowthLookupService,
  ) {}

  @Get('lookup')
  @ApiOperation({
    summary:
      '?code= a CT- catering code, an FC- order code, or a tiffin subscription id → the record (audited).',
  })
  @ApiEnvelopeOk(AdminGrowthLookupView)
  lookup(@Query('code') code = '') {
    return this.lookups.lookup(code.slice(0, 64));
  }

  @Get('demand-map')
  @ApiOperation({
    summary:
      '?city&cuisineId&hour&week — the platform view of a city’s demand cells (same k = 5 threshold as vendors).',
  })
  @ApiEnvelopeOk(AdminGrowthDemandMapView)
  demandMap(@Query() q: AdminDemandMapQueryDto) {
    const { city, ...rest } = q;
    return this.demand.map({ city, ...rest });
  }

  @Get('demand-map/cities')
  @ApiOperation({
    summary: 'Cities with demand data: latest week and searches.',
  })
  @ApiEnvelopeOk(AdminGrowthDemandCitiesView)
  demandCities() {
    return this.demand.cities();
  }

  @Get('calendar-events')
  @ApiOperation({ summary: '?kind&from&city&page — Ramadan, Eid, holidays.' })
  @ApiPagedOk(AdminGrowthEventsView)
  events(@Query() q: CalendarEventsQueryDto) {
    return this.ramadan.listEvents(q);
  }

  @Post('calendar-events')
  @ApiOperation({
    summary:
      '{ kind (ramadan|eid|public_holiday|other), name, startsOn, endsOn, city? (null = everywhere) } — Ramadan events switch on kitchens’ sehri/iftar hours; every event feeds the forecast.',
  })
  @ApiEnvelopeOk(AdminGrowthCreateEventView, { status: 201 })
  createEvent(@Body() dto: CalendarEventDto) {
    return this.ramadan.createEvent(dto);
  }

  @Patch('calendar-events/:id')
  @ApiEnvelopeOk(AdminGrowthUpdateEventView)
  updateEvent(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCalendarEventDto,
  ) {
    return this.ramadan.updateEvent(id, dto);
  }

  @Delete('calendar-events/:id')
  @ApiEnvelopeOk(AdminGrowthRemoveEventView)
  removeEvent(@Param('id', ParseUUIDPipe) id: string) {
    return this.ramadan.removeEvent(id);
  }

  @Get('hygiene')
  @ApiOperation({
    summary:
      '?status=self_declared (the queue, oldest first) | verified — kitchens with a complete checklist.',
  })
  @ApiPagedOk(AdminGrowthHygieneView)
  hygiene(@Query() q: HygieneQueueQueryDto) {
    return this.stories.hygieneQueue(q);
  }

  @Post('hygiene/:brandId/verify')
  @HttpCode(200)
  @ApiOperation({
    summary:
      '{ method: visit|video_call, note? } — self_declared → verified. Any later checklist change drops it back.',
  })
  @ApiEnvelopeOk(AdminGrowthVerifyView)
  verify(
    @Param('brandId', ParseUUIDPipe) brandId: string,
    @Body() dto: HygieneVerifyDto,
  ) {
    return this.stories.verify(brandId, dto);
  }

  @Post('hygiene/:brandId/revoke')
  @HttpCode(200)
  @ApiOperation({ summary: '{ reason } — verified → self_declared.' })
  @ApiEnvelopeOk(AdminGrowthRevokeView)
  revoke(
    @Param('brandId', ParseUUIDPipe) brandId: string,
    @Body() dto: SignatureReasonDto,
  ) {
    return this.stories.revoke(brandId, dto.reason);
  }

  @Get('signatures')
  @ApiOperation({
    summary:
      '?status=claimed (newest first) | removed — signature recipe claims.',
  })
  @ApiPagedOk(AdminGrowthSignaturesView)
  signatures(@Query() q: SignatureQueueQueryDto) {
    return this.stories.signatures(q);
  }

  @Post('signatures/:recipeCardId/remove')
  @HttpCode(200)
  @ApiOperation({
    summary:
      '{ reason } — removes a false claim; the vendor is told and may claim again (it comes back to this list).',
  })
  @ApiEnvelopeOk(AdminGrowthRemoveSignatureView)
  removeSignature(
    @Param('recipeCardId', ParseUUIDPipe) id: string,
    @Body() dto: SignatureReasonDto,
  ) {
    return this.stories.removeSignature(id, dto.reason);
  }
}
