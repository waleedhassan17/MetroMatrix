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
import {
  CalendarEventDto,
  CalendarEventsQueryDto,
  UpdateCalendarEventDto,
} from '../ramadan/dto/ramadan.dto';
import {
  HygieneQueueQueryDto,
  HygieneVerifyDto,
  ReasonDto,
  SignatureQueueQueryDto,
} from '../story/dto/story.dto';
import { RamadanService } from '../ramadan/ramadan.service';
import { StoryService } from '../story/story.service';

/** Staff: the calendar, hygiene verification and signature moderation (Chunk 5, P7). Every write is audited. */
@ApiTags('admin · food growth')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@Controller('admin/food')
export class AdminGrowthController {
  constructor(
    private readonly ramadan: RamadanService,
    private readonly stories: StoryService,
  ) {}

  @Get('calendar-events')
  @ApiOperation({ summary: '?kind&from&city&page — Ramadan, Eid, holidays.' })
  events(@Query() q: CalendarEventsQueryDto) {
    return this.ramadan.listEvents(q);
  }

  @Post('calendar-events')
  @ApiOperation({
    summary:
      '{ kind (ramadan|eid|public_holiday|other), name, startsOn, endsOn, city? (null = everywhere) } — Ramadan events switch on kitchens’ sehri/iftar hours; every event feeds the forecast.',
  })
  createEvent(@Body() dto: CalendarEventDto) {
    return this.ramadan.createEvent(dto);
  }

  @Patch('calendar-events/:id')
  updateEvent(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCalendarEventDto,
  ) {
    return this.ramadan.updateEvent(id, dto);
  }

  @Delete('calendar-events/:id')
  removeEvent(@Param('id', ParseUUIDPipe) id: string) {
    return this.ramadan.removeEvent(id);
  }

  @Get('hygiene')
  @ApiOperation({
    summary:
      '?status=self_declared (the queue, oldest first) | verified — kitchens with a complete checklist.',
  })
  hygiene(@Query() q: HygieneQueueQueryDto) {
    return this.stories.hygieneQueue(q);
  }

  @Post('hygiene/:brandId/verify')
  @HttpCode(200)
  @ApiOperation({
    summary:
      '{ method: visit|video_call, note? } — self_declared → verified. Any later checklist change drops it back.',
  })
  verify(
    @Param('brandId', ParseUUIDPipe) brandId: string,
    @Body() dto: HygieneVerifyDto,
  ) {
    return this.stories.verify(brandId, dto);
  }

  @Post('hygiene/:brandId/revoke')
  @HttpCode(200)
  @ApiOperation({ summary: '{ reason } — verified → self_declared.' })
  revoke(
    @Param('brandId', ParseUUIDPipe) brandId: string,
    @Body() dto: ReasonDto,
  ) {
    return this.stories.revoke(brandId, dto.reason);
  }

  @Get('signatures')
  @ApiOperation({
    summary:
      '?status=claimed (newest first) | removed — signature recipe claims.',
  })
  signatures(@Query() q: SignatureQueueQueryDto) {
    return this.stories.signatures(q);
  }

  @Post('signatures/:recipeCardId/remove')
  @HttpCode(200)
  @ApiOperation({
    summary:
      '{ reason } — removes a false claim; the vendor is told and may claim again (it comes back to this list).',
  })
  removeSignature(
    @Param('recipeCardId', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.stories.removeSignature(id, dto.reason);
  }
}
