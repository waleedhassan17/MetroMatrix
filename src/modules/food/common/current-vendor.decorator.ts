import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import type { VendorRef } from '../vendor/food-vendor.service';
import type { RiderRef } from './rider.guard';

/** The signed-in vendor (VendorGuard). Every vendor query is scoped by its ids. */
export const CurrentVendor = createParamDecorator(
  (_d: unknown, ctx: ExecutionContext): VendorRef =>
    ctx.switchToHttp().getRequest<Request & { vendor?: VendorRef }>().vendor!,
);

/** The signed-in rider (RiderGuard). */
export const CurrentRider = createParamDecorator(
  (_d: unknown, ctx: ExecutionContext): RiderRef =>
    ctx.switchToHttp().getRequest<Request & { rider?: RiderRef }>().rider!,
);
