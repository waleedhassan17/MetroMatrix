import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AppointmentsService } from './appointments.service';
import { AppointmentViewsService } from './appointment-views.service';
import {
  AppointmentReasonDto,
  BookAppointmentDto,
  PatientAppointmentQueryDto,
  PaymentProofDto,
  RefundDto,
  RescheduleDto,
} from './dto/appointment.dto';
import { HealthDoctor, HealthPatient } from '../common/health-roles.decorator';
import {
  CurrentDoctor,
  CurrentDoctorRef,
} from '../common/current-doctor.decorator';
import { RequireIdempotencyKey } from '../../../common/decorators/require-idempotency-key.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';

@ApiTags('health · patient')
@HealthPatient()
@Controller('health/appointments')
export class PatientAppointmentsController {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly views: AppointmentViewsService,
  ) {}

  @Post()
  @RequireIdempotencyKey()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'A fresh UUID per booking attempt.',
  })
  @ApiOperation({
    summary:
      '{ doctorId, locationId, startsAt (a real slot), familyMemberId?, reason?, symptoms?, attachmentRecordIds? } — fee from the location. 409 SLOT_TAKEN carries 3 alternatives.',
  })
  book(@CurrentUser() me: AuthenticatedUser, @Body() dto: BookAppointmentDto) {
    return this.appointments.book(me.id, dto);
  }

  @Get()
  @ApiOperation({ summary: '?scope=upcoming|past&page' })
  list(
    @CurrentUser() me: AuthenticatedUser,
    @Query() q: PatientAppointmentQueryDto,
  ) {
    return this.views.patientList(me.id, q);
  }

  @Get(':code')
  @ApiOperation({
    summary:
      'Detail with timeline, location, payment instructions and can* flags.',
  })
  get(@CurrentUser() me: AuthenticatedUser, @Param('code') code: string) {
    return this.views.forPatient(me.id, code);
  }

  @Post(':code/cancel')
  @HttpCode(200)
  @ApiOperation({
    summary:
      '{ reason } — until the start; inside the cutoff it is marked lateCancel.',
  })
  cancel(
    @CurrentUser() me: AuthenticatedUser,
    @Param('code') code: string,
    @Body() dto: AppointmentReasonDto,
  ) {
    return this.appointments.patientCancel(me.id, code, dto.reason);
  }

  @Post(':code/reschedule')
  @HttpCode(200)
  @RequireIdempotencyKey()
  @ApiOperation({
    summary:
      '{ startsAt } — same doctor and location, once, before the cutoff. Returns the new appointment.',
  })
  reschedule(
    @CurrentUser() me: AuthenticatedUser,
    @Param('code') code: string,
    @Body() dto: RescheduleDto,
  ) {
    return this.appointments.reschedule(me.id, code, dto.startsAt);
  }

  @Post(':code/payment-proof')
  @HttpCode(200)
  @ApiOperation({
    summary:
      '{ paymentRef, proofUrl? } — video fees transferred to the doctor.',
  })
  proof(
    @CurrentUser() me: AuthenticatedUser,
    @Param('code') code: string,
    @Body() dto: PaymentProofDto,
  ) {
    return this.appointments.submitPaymentProof(me.id, code, dto);
  }
}

@ApiTags('health · doctor')
@HealthDoctor()
@Controller('health/doctor/appointments')
export class DoctorAppointmentPaymentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Post(':code/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: '{ reason } — required; the patient is told.' })
  cancel(
    @CurrentDoctor() d: CurrentDoctorRef,
    @Param('code') code: string,
    @Body() dto: AppointmentReasonDto,
  ) {
    return this.appointments.doctorCancel(
      d.id,
      d.ownerUserId,
      code,
      dto.reason,
    );
  }

  @Post(':code/payment/confirm')
  @HttpCode(200)
  confirm(@CurrentDoctor() d: CurrentDoctorRef, @Param('code') code: string) {
    return this.appointments.confirmPayment(d.id, d.ownerUserId, code);
  }

  @Post(':code/payment/reject')
  @HttpCode(200)
  @ApiOperation({
    summary:
      '{ reason } — transfer not received; the patient gets ≥ 2 h to resubmit (never past the start).',
  })
  reject(
    @CurrentDoctor() d: CurrentDoctorRef,
    @Param('code') code: string,
    @Body() dto: AppointmentReasonDto,
  ) {
    return this.appointments.rejectPayment(
      d.id,
      d.ownerUserId,
      code,
      dto.reason,
    );
  }

  @Post(':code/refund')
  @HttpCode(200)
  @ApiOperation({
    summary: '{ refundRef } — refund_due → refunded (sent off-platform).',
  })
  refund(
    @CurrentDoctor() d: CurrentDoctorRef,
    @Param('code') code: string,
    @Body() dto: RefundDto,
  ) {
    return this.appointments.refund(d.id, d.ownerUserId, code, dto);
  }
}
