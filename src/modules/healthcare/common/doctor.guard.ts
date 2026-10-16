import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { ApprovedBusiness } from '../../../common/decorators/current-business.decorator';
import { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import { DoctorsService } from '../doctors/doctors.service';
import { CurrentDoctorRef } from './current-doctor.decorator';

/**
 * Resolves the doctor row of the approved healthcare business and puts it on
 * the request for @CurrentDoctor(). Runs after BusinessApprovedGuard and
 * ServiceTypeGuard('healthcare'). A doctor approved before Healthcare existed
 * gets their row here, on first use.
 */
@Injectable()
export class DoctorGuard implements CanActivate {
  constructor(private readonly doctors: DoctorsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<
      Request & {
        user?: AuthenticatedUser;
        business?: ApprovedBusiness;
        doctor?: CurrentDoctorRef;
      }
    >();
    const id = await this.doctors.ensureForBusinessId(req.business!.id);
    req.doctor = {
      id,
      businessId: req.business!.id,
      ownerUserId: req.user!.id,
    };
    return true;
  }
}
