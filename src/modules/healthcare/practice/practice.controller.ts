import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseArrayPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PracticeService } from './practice.service';
import { AvailabilityService } from '../availability/availability.service';
import { SlotsQueryDto } from '../discovery/dto/discovery.dto';
import {
  CreateLocationDto,
  CreateTimeOffDto,
  ScheduleRangeDto,
  UpdateLocationDto,
} from './dto/practice.dto';
import { HealthDoctor } from '../common/health-roles.decorator';
import {
  CurrentDoctor,
  CurrentDoctorRef,
} from '../common/current-doctor.decorator';
import { validationExceptionFactory } from '../../../common/validation/validation-exception.factory';

const uuid = new ParseUUIDPipe();

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
      '?from&days=7 — the slots patients will see, per active location (check before publishing).',
  })
  preview(@CurrentDoctor() d: CurrentDoctorRef, @Query() q: SlotsQueryDto) {
    return this.availability.preview(d.id, q.from, q.days ?? 7);
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
      'isActive: false is refused while patients are booked there (LOCATION_HAS_BOOKINGS).',
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
      'Replace the week: [{ weekday 0–6 (Sun–Sat), start "HH:mm", end "HH:mm" }] in the location’s zone. Overlaps across locations → SCHEDULE_OVERLAP.',
  })
  replaceSchedule(
    @CurrentDoctor() d: CurrentDoctorRef,
    @Param('id', uuid) id: string,
    @Body(
      new ParseArrayPipe({
        items: ScheduleRangeDto,
        whitelist: true,
        exceptionFactory: validationExceptionFactory,
      }),
    )
    ranges: ScheduleRangeDto[],
  ) {
    return this.practice.replaceSchedule(d.id, id, ranges.slice(0, 100));
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
