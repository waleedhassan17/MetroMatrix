import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseArrayPipe,
  ParseUUIDPipe,
  Patch,
  PipeTransform,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PracticeService } from './practice.service';
import {
  AvailabilityService,
  DOCTOR_WINDOW_DAYS,
} from '../availability/availability.service';
import { SlotsQueryDto } from '../discovery/dto/discovery.dto';
import {
  CreateLocationDto,
  CreateTimeOffDto,
  OverridesQueryDto,
  ScheduleOverrideDto,
  ScheduleQueryDto,
  ScheduleRangeDto,
  UpdateLocationDto,
} from './dto/practice.dto';
import { HealthDoctor } from '../common/health-roles.decorator';
import {
  CurrentDoctor,
  CurrentDoctorRef,
} from '../common/current-doctor.decorator';
import { validationExceptionFactory } from '../../../common/validation/validation-exception.factory';
import { ErrorCode } from '../../../common/errors/codes';

/** "YYYY-MM-DD", a real calendar date, else 400 VALIDATION_FAILED. */
class ParseDatePipe implements PipeTransform<string, string> {
  transform(value: string): string {
    const ok =
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
    if (!ok)
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'date must be YYYY-MM-DD',
        details: { fields: { date: ['date must be YYYY-MM-DD'] } },
      });
    return value;
  }
}

const uuid = new ParseUUIDPipe();
/** A local date in the path ("2026-11-28"). */
const dateParam = new ParseDatePipe();

@ApiTags('health · doctor')
@HealthDoctor()
@Controller('health/doctor')
export class PracticeController {
  constructor(
    private readonly practice: PracticeService,
    private readonly availability: AvailabilityService,
  ) {}

  @Get('availability/preview')
  @ApiOperation({
    summary:
      '?from&days=7 — the slots patients will see, per active location (check before publishing). paused: patients see none while bookings are off.',
  })
  preview(@CurrentDoctor() d: CurrentDoctorRef, @Query() q: SlotsQueryDto) {
    return this.availability.preview(d.id, q.from, q.days ?? 7);
  }

  @Get('locations/:id/slots')
  @ApiOperation({
    summary: `?from&days (≤30) — your own free slots at a location, for moving a visit or booking a follow-up: no minimum notice, bookings on or paused, up to ${DOCTOR_WINDOW_DAYS} days ahead.`,
  })
  ownSlots(
    @CurrentDoctor() d: CurrentDoctorRef,
    @Param('id', uuid) id: string,
    @Query() q: SlotsQueryDto,
  ) {
    return this.availability.slots(d.id, id, q.from, q.days ?? 7, {
      ignorePause: true,
      minNoticeMinutes: 0,
      bookingWindowDays: DOCTOR_WINDOW_DAYS,
    });
  }

  @Get('locations')
  locations(@CurrentDoctor() d: CurrentDoctorRef) {
    return this.practice.locations(d.id);
  }

  @Post('locations')
  @ApiOperation({
    summary:
      'A clinic (address required) or your video consultation (at most one active).',
  })
  create(@CurrentDoctor() d: CurrentDoctorRef, @Body() dto: CreateLocationDto) {
    return this.practice.createLocation(d.id, dto);
  }

  @Patch('locations/:id')
  @ApiOperation({
    summary:
      'isActive: false is refused while patients are booked there (LOCATION_HAS_BOOKINGS). Switching back on or changing the zone re-checks the hours (SCHEDULE_OVERLAP); outsideHours lists booked visits its hours no longer cover.',
  })
  update(
    @CurrentDoctor() d: CurrentDoctorRef,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.practice.updateLocation(d.id, id, dto);
  }

  @Delete('locations/:id')
  remove(@CurrentDoctor() d: CurrentDoctorRef, @Param('id', uuid) id: string) {
    return this.practice.removeLocation(d.id, id);
  }

  @Get('locations/:id/schedule')
  schedule(
    @CurrentDoctor() d: CurrentDoctorRef,
    @Param('id', uuid) id: string,
  ) {
    return this.practice.schedule(d.id, id);
  }

  @Put('locations/:id/schedule')
  @ApiBody({ type: [ScheduleRangeDto] })
  @ApiOperation({
    summary:
      'Replace the week: [{ weekday 0–6 (Sun–Sat), start "HH:mm", end "HH:mm" }] in the location’s zone. Overlapping another location of the same kind → SCHEDULE_OVERLAP; a clinic and the video consultation may share hours in one zone (sharedWith: booking either closes the other). Answers outsideHours (booked visits the new hours leave out — they stay booked) and slotsPerWeek; ?dryRun=true reports without saving.',
  })
  replaceSchedule(
    @CurrentDoctor() d: CurrentDoctorRef,
    @Param('id', uuid) id: string,
    @Query() q: ScheduleQueryDto,
    @Body(
      new ParseArrayPipe({
        items: ScheduleRangeDto,
        whitelist: true,
        exceptionFactory: validationExceptionFactory,
      }),
    )
    ranges: ScheduleRangeDto[],
  ) {
    return this.practice.replaceSchedule(d.id, id, ranges.slice(0, 100), {
      dryRun: q.dryRun === 'true',
    });
  }

  @Get('locations/:id/overrides')
  @ApiOperation({
    summary:
      '?from&to (local dates; default today … 60 days on) — day-specific hours: [{ date, closed, ranges, note }].',
  })
  overrides(
    @CurrentDoctor() d: CurrentDoctorRef,
    @Param('id', uuid) id: string,
    @Query() q: OverridesQueryDto,
  ) {
    return this.practice.overrides(d.id, id, q.from, q.to);
  }

  @Put('locations/:id/overrides/:date')
  @ApiOperation({
    summary:
      '{ closed?, ranges?: [{ start, end }], note? } — this date’s own hours (extra, shorter, or closed), replacing its weekly hours. Checked like the week (SCHEDULE_OVERLAP; a clinic and video may share). Answers sharedWith, outsideHours (booked visits left out — they stay booked), slots; ?dryRun=true reports without saving.',
  })
  setOverride(
    @CurrentDoctor() d: CurrentDoctorRef,
    @Param('id', uuid) id: string,
    @Param('date', dateParam) date: string,
    @Query() q: ScheduleQueryDto,
    @Body() dto: ScheduleOverrideDto,
  ) {
    return this.practice.setOverride(d.id, id, date, dto, {
      dryRun: q.dryRun === 'true',
    });
  }

  @Delete('locations/:id/overrides/:date')
  @ApiOperation({
    summary:
      'Back to the weekly hours on that date; answers outsideHours (booked visits they leave out).',
  })
  removeOverride(
    @CurrentDoctor() d: CurrentDoctorRef,
    @Param('id', uuid) id: string,
    @Param('date', dateParam) date: string,
  ) {
    return this.practice.removeOverride(d.id, id, date);
  }

  @Get('time-off')
  timeOff(@CurrentDoctor() d: CurrentDoctorRef) {
    return this.practice.timeOff(d.id);
  }

  @Post('time-off')
  @ApiOperation({
    summary:
      'Booked appointments inside it → TIME_OFF_CONFLICTS unless cancelAffected: true.',
  })
  addTimeOff(
    @CurrentDoctor() d: CurrentDoctorRef,
    @Body() dto: CreateTimeOffDto,
  ) {
    return this.practice.addTimeOff(d.id, dto);
  }

  @Delete('time-off/:id')
  removeTimeOff(
    @CurrentDoctor() d: CurrentDoctorRef,
    @Param('id', uuid) id: string,
  ) {
    return this.practice.removeTimeOff(d.id, id);
  }
}
