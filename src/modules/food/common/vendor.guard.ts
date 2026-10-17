import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { ApprovedBusiness } from '../../../common/decorators/current-business.decorator';
import { FoodVendorService, VendorRef } from '../vendor/food-vendor.service';

/**
 * Resolves the approved food business's single brand and branch for
 * @CurrentVendor(). Runs after BusinessApprovedGuard and ServiceTypeGuard('food').
 */
@Injectable()
export class VendorGuard implements CanActivate {
  constructor(private readonly vendors: FoodVendorService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<
        Request & { business?: ApprovedBusiness; vendor?: VendorRef }
      >();
    req.vendor = await this.vendors.ensureForBusinessId(req.business!.id);
    return true;
  }
}
