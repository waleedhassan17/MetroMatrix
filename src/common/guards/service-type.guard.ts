import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  mixin,
  Type,
} from '@nestjs/common';
import { Request } from 'express';
import { ApprovedBusiness } from '../decorators/current-business.decorator';
import { ErrorCode } from '../errors/codes';

const SERVICE_NAMES: Record<string, string> = {
  shopping: 'Shopping',
  healthcare: 'Healthcare',
  food: 'Food',
};

/**
 * Keeps each service's partner routes to that service's partners: a doctor
 * calling /shop/partner/* gets 403 WRONG_SERVICE.
 *
 * Runs after BusinessApprovedGuard, which puts the business on the request:
 *   @UseGuards(BusinessApprovedGuard, ServiceTypeGuard('shopping'))
 */
export function ServiceTypeGuard(service: string): Type<CanActivate> {
  @Injectable()
  class ServiceTypeGuardMixin implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      const req = context
        .switchToHttp()
        .getRequest<Request & { business?: ApprovedBusiness }>();
      const actual = req.business?.serviceType;
      if (actual === service) return true;
      throw new ForbiddenException({
        code: ErrorCode.WRONG_SERVICE,
        message: `This is part of MetroMatrix ${SERVICE_NAMES[service] ?? service}; your business is registered for ${SERVICE_NAMES[actual ?? ''] ?? 'another service'}.`,
        details: { required: service, actual: actual ?? null },
      });
    }
  }
  return mixin(ServiceTypeGuardMixin);
}
