import { Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { VideoService } from './video.service';
import { HealthDoctor, HealthPatient } from '../common/health-roles.decorator';
import {
  CurrentDoctor,
  CurrentDoctorRef,
} from '../common/current-doctor.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';

@ApiTags('health · patient')
@HealthPatient()
@Controller('health/appointments')
export class PatientVideoController {
  constructor(private readonly video: VideoService) {}

  @Post(':code/video/join')
  @HttpCode(200)
  @ApiOperation({
    summary:
      '{ provider, domain, roomName, joinUrl, jwt, expiresAt, window } — 409 VIDEO_NOT_JOINABLE outside starts−10 min … ends+30 min; 402 PAYMENT_REQUIRED for unconfirmed prepayment.',
  })
  join(@CurrentUser() me: AuthenticatedUser, @Param('code') code: string) {
    return this.video.patientJoin(me.id, code);
  }
}

@ApiTags('health · doctor')
@HealthDoctor()
@Controller('health/doctor/appointments')
export class DoctorVideoController {
  constructor(private readonly video: VideoService) {}

  @Post(':code/video/join')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Joins as moderator and starts the consultation (booked → in_consultation). Same window and payment rules.',
  })
  join(@CurrentDoctor() d: CurrentDoctorRef, @Param('code') code: string) {
    return this.video.doctorJoin(d.id, d.ownerUserId, code);
  }
}
