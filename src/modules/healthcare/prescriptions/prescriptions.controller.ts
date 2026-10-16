import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrescriptionsService } from './prescriptions.service';
import {
  MedicineSuggestDto,
  PatientPrescriptionQueryDto,
  WritePrescriptionDto,
} from './dto/prescription.dto';
import { HealthDoctor, HealthPatient } from '../common/health-roles.decorator';
import {
  CurrentDoctor,
  CurrentDoctorRef,
} from '../common/current-doctor.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';

@ApiTags('health · doctor')
@HealthDoctor()
@Controller('health/doctor')
export class DoctorPrescriptionsController {
  constructor(private readonly prescriptions: PrescriptionsService) {}

  @Get('appointments/:code/prescription')
  @ApiOperation({
    summary: '{ prescription | null, locked }. Audited when one exists.',
  })
  current(@CurrentDoctor() d: CurrentDoctorRef, @Param('code') code: string) {
    return this.prescriptions.forAppointment(d.id, d.ownerUserId, code);
  }

  @Post('appointments/:code/prescription')
  @ApiOperation({
    summary:
      '{ diagnosis, advice?, followUpInDays?, medicines[], tests? } — writes or replaces; from in_consultation until 24 h after completion (else 409 PRESCRIPTION_LOCKED).',
  })
  write(
    @CurrentDoctor() d: CurrentDoctorRef,
    @Param('code') code: string,
    @Body() dto: WritePrescriptionDto,
  ) {
    return this.prescriptions.write(d.id, d.ownerUserId, code, dto);
  }

  @Get('prescriptions/:id')
  @ApiOperation({
    summary: 'Only the prescribing doctor (any other doctor: 404). Audited.',
  })
  get(
    @CurrentDoctor() d: CurrentDoctorRef,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.prescriptions.forDoctor(d.id, d.ownerUserId, id);
  }

  @Get('medicines/suggest')
  @ApiOperation({
    summary:
      '?q — your favourites (with your usual dose) first, then the reference list.',
  })
  suggest(
    @CurrentDoctor() d: CurrentDoctorRef,
    @Query() q: MedicineSuggestDto,
  ) {
    return this.prescriptions.suggest(d.id, q.q);
  }
}

@ApiTags('health · patient')
@HealthPatient()
@Controller('health/prescriptions')
export class PatientPrescriptionsController {
  constructor(private readonly prescriptions: PrescriptionsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Every prescription on your account, newest first. ?familyMemberId&page',
  })
  list(
    @CurrentUser() me: AuthenticatedUser,
    @Query() q: PatientPrescriptionQueryDto,
  ) {
    return this.prescriptions.patientList(me.id, q);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'With the doctor header (name, qualifications, PMDC number, location).',
  })
  get(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.prescriptions.forPatient(me.id, id);
  }
}
