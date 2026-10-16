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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DoctorsService } from './doctors.service';
import {
  DoctorPaymentAccountDto,
  UpdateDoctorPaymentAccountDto,
  UpdateDoctorProfileDto,
} from './dto/profile.dto';
import { HealthDoctor } from '../common/health-roles.decorator';
import {
  CurrentDoctor,
  CurrentDoctorRef,
} from '../common/current-doctor.decorator';

const uuid = new ParseUUIDPipe();

@ApiTags('health · doctor')
@HealthDoctor()
@Controller('health/doctor')
export class DoctorProfileController {
  constructor(private readonly doctors: DoctorsService) {}

  @Get('profile')
  @ApiOperation({
    summary:
      'Your profile with qualifications, experiences, services, conditions, booking rules, stats.',
  })
  profile(@CurrentDoctor() d: CurrentDoctorRef) {
    return this.doctors.profile(d.id);
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Any field; list fields replace the stored list.' })
  update(
    @CurrentDoctor() d: CurrentDoctorRef,
    @Body() dto: UpdateDoctorProfileDto,
  ) {
    return this.doctors.updateProfile(d.id, d.ownerUserId, dto);
  }

  @Get('profile/completeness')
  @ApiOperation({
    summary: '{ percent, missing, isListed } — the setup checklist.',
  })
  completeness(@CurrentDoctor() d: CurrentDoctorRef) {
    return this.doctors.completeness(d.id);
  }

  @Post('listing/publish')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Show your profile to patients (needs 100% completeness).',
  })
  publish(@CurrentDoctor() d: CurrentDoctorRef) {
    return this.doctors.publish(d.id);
  }

  @Post('listing/unpublish')
  @HttpCode(200)
  unpublish(@CurrentDoctor() d: CurrentDoctorRef) {
    return this.doctors.unpublish(d.id);
  }

  @Get('payment-accounts')
  accounts(@CurrentDoctor() d: CurrentDoctorRef) {
    return this.doctors.listAccounts(d.id);
  }

  @Post('payment-accounts')
  @ApiOperation({
    summary:
      'Your own account for video-fee transfers (bank IBAN or mobile wallet). Max 4 active.',
  })
  addAccount(
    @CurrentDoctor() d: CurrentDoctorRef,
    @Body() dto: DoctorPaymentAccountDto,
  ) {
    return this.doctors.addAccount(d.id, dto);
  }

  @Patch('payment-accounts/:id')
  updateAccount(
    @CurrentDoctor() d: CurrentDoctorRef,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateDoctorPaymentAccountDto,
  ) {
    return this.doctors.updateAccount(d.id, id, dto);
  }

  @Delete('payment-accounts/:id')
  removeAccount(
    @CurrentDoctor() d: CurrentDoctorRef,
    @Param('id', uuid) id: string,
  ) {
    return this.doctors.removeAccount(d.id, id);
  }
}
