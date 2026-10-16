import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Roles } from '../../../common/decorators/roles.decorator';
import { BusinessApprovedGuard } from '../../../common/guards/business-approved.guard';
import { EmailVerifiedGuard } from '../../../common/guards/email-verified.guard';
import { ServiceTypeGuard } from '../../../common/guards/service-type.guard';
import { DoctorGuard } from './doctor.guard';

export const HealthcareServiceGuard = ServiceTypeGuard('healthcare');

/**
 * Every /health/doctor route: a partner whose business is approved and
 * registered for Healthcare (else 403 FORBIDDEN / BUSINESS_NOT_APPROVED /
 * WRONG_SERVICE). Read the doctor with @CurrentDoctor().
 */
export const HealthDoctor = () =>
  applyDecorators(
    ApiBearerAuth(),
    Roles('partner'),
    UseGuards(BusinessApprovedGuard, HealthcareServiceGuard, DoctorGuard),
  );

/** Patient routes: a signed-in customer with a verified email. */
export const HealthPatient = () =>
  applyDecorators(
    ApiBearerAuth(),
    Roles('customer'),
    UseGuards(EmailVerifiedGuard),
  );
