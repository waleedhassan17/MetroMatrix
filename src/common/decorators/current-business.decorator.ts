import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

/** What BusinessApprovedGuard puts on the request for partner routes. */
export interface ApprovedBusiness {
  id: string;
  status: 'approved';
  serviceType: string;
  subType: string;
}

/**
 * The signed-in partner's approved business. Only meaningful behind
 * BusinessApprovedGuard (the FinMatrix @CurrentCompany() pattern).
 */
export const CurrentBusiness = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ApprovedBusiness | null => {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { business?: ApprovedBusiness }>();
    return req.business ?? null;
  },
);
