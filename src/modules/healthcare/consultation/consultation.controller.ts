import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConsultationService } from './consultation.service';
import {
  InsightsQueryDto,
  NotesDto,
  PatientQueryDto,
} from './dto/consultation.dto';
import {
  CompleteDto,
  DoctorAppointmentQueryDto,
} from '../appointments/dto/appointment.dto';
import { DoctorInsightsService } from '../insights/doctor-insights.service';
import { HealthDoctor } from '../common/health-roles.decorator';
import {
  CurrentDoctor,
  CurrentDoctorRef,
} from '../common/current-doctor.decorator';

@ApiTags('health · doctor')
@HealthDoctor()
@Controller('health/doctor')
export class ConsultationController {
  constructor(
    private readonly consultation: ConsultationService,
    private readonly insightsService: DoctorInsightsService,
  ) {}

  @Get('today')
  @ApiOperation({
    summary:
      "Today's queue across locations: in consultation, waiting (checked in, by arrival), still to come, done — with waitingMinutes, flags and can* actions.",
  })
  today(@CurrentDoctor() d: CurrentDoctorRef) {
    return this.consultation.today(d.id);
  }

  @Get('appointments')
  @ApiOperation({
    summary: '?date (local day) | from & to, status, locationId, page',
  })
  list(
    @CurrentDoctor() d: CurrentDoctorRef,
    @Query() q: DoctorAppointmentQueryDto,
  ) {
    return this.consultation.list(d.id, q);
  }

  @Get('appointments/:code')
  @ApiOperation({
    summary:
      'Detail + the history with this doctor + shared records. Audited (phi.read).',
  })
  detail(@CurrentDoctor() d: CurrentDoctorRef, @Param('code') code: string) {
    return this.consultation.detail(d.id, d.ownerUserId, code);
  }

  @Post('appointments/:code/check-in')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Clinic only: booked → checked_in (the patient has arrived).',
  })
  checkIn(@CurrentDoctor() d: CurrentDoctorRef, @Param('code') code: string) {
    return this.consultation.checkIn(d.id, d.ownerUserId, code);
  }

  @Post('appointments/:code/start')
  @HttpCode(200)
  @ApiOperation({
    summary: 'checked_in (clinic) or booked (video) → in_consultation.',
  })
  start(@CurrentDoctor() d: CurrentDoctorRef, @Param('code') code: string) {
    return this.consultation.start(d.id, d.ownerUserId, code);
  }

  @Post('appointments/:code/complete')
  @HttpCode(200)
  @ApiOperation({
    summary:
      '{ paymentCollected? } — in_consultation → completed; collected → paid.',
  })
  complete(
    @CurrentDoctor() d: CurrentDoctorRef,
    @Param('code') code: string,
    @Body() dto: CompleteDto,
  ) {
    return this.consultation.complete(
      d.id,
      d.ownerUserId,
      code,
      dto.paymentCollected === true,
    );
  }

  @Post('appointments/:code/no-show')
  @HttpCode(200)
  @ApiOperation({
    summary: 'booked → no_show, from 15 minutes after the start.',
  })
  noShow(@CurrentDoctor() d: CurrentDoctorRef, @Param('code') code: string) {
    return this.consultation.noShow(d.id, d.ownerUserId, code);
  }

  @Get('appointments/:code/notes')
  @ApiOperation({
    summary: 'Private notes (never shown to the patient). Audited.',
  })
  notes(@CurrentDoctor() d: CurrentDoctorRef, @Param('code') code: string) {
    return this.consultation.notes(d.id, d.ownerUserId, code);
  }

  @Put('appointments/:code/notes')
  @ApiOperation({
    summary:
      '{ text, files?: [{ url, publicId, mime? }] } — files signed for purpose medical_note.',
  })
  saveNotes(
    @CurrentDoctor() d: CurrentDoctorRef,
    @Param('code') code: string,
    @Body() dto: NotesDto,
  ) {
    return this.consultation.saveNotes(d.id, d.ownerUserId, code, dto);
  }

  @Get('patients')
  @ApiOperation({
    summary:
      'People with at least one appointment with you. ?q (name/phone)&page',
  })
  patients(@CurrentDoctor() d: CurrentDoctorRef, @Query() q: PatientQueryDto) {
    return this.consultation.patients(d.id, q);
  }

  @Get('patients/:patientKey')
  @ApiOperation({
    summary:
      'History with you only; 404 without an appointment between you. Audited.',
  })
  patient(
    @CurrentDoctor() d: CurrentDoctorRef,
    @Param('patientKey', ParseUUIDPipe) key: string,
  ) {
    return this.consultation.patient(d.id, d.ownerUserId, key);
  }

  @Get('insights')
  @ApiOperation({
    summary:
      '?range=7d|30d|90d — volume, rates, wait/consult, new vs returning, recorded fees, rating trend.',
  })
  insights(@CurrentDoctor() d: CurrentDoctorRef, @Query() q: InsightsQueryDto) {
    return this.insightsService.insights(d.id, q.range ?? '30d');
  }
}
