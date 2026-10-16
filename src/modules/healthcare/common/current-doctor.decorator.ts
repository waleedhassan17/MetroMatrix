import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

/** What DoctorGuard puts on the request. */
export interface CurrentDoctorRef {
  id: string;
  businessId: string;
  /** The doctor's user id (the business owner). */
  ownerUserId: string;
}

/**
 * The signed-in doctor. Every doctor service call takes `doctor.id` as its
 * scope, so another doctor's rows are simply never found (404).
 */
export const CurrentDoctor = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentDoctorRef =>
    ctx.switchToHttp().getRequest<Request & { doctor?: CurrentDoctorRef }>()
      .doctor!,
);
