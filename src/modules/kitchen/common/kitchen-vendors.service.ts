import { ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import { approvedBusinessOf } from '../../../common/guards/business-approved.guard';
import { assertEmailVerified } from '../../../common/utils/email-verified.util';
import { ErrorCode } from '../../../common/errors/codes';
import {
  FoodVendorService,
  VendorRef,
} from '../../food/vendor/food-vendor.service';

/**
 * The @FoodVendor() checks for code that isn't behind those guards (the
 * voice endpoint takes vendors and customers): partner, approved, food.
 */
@Injectable()
export class KitchenVendors {
  constructor(
    private readonly dataSource: DataSource,
    private readonly vendors: FoodVendorService,
  ) {}

  async forUser(user: AuthenticatedUser): Promise<VendorRef> {
    if (user.role !== 'partner')
      throw new ForbiddenException({
        code: ErrorCode.FORBIDDEN,
        message: 'This screen is for food vendors.',
      });
    const b = await approvedBusinessOf(this.dataSource, user);
    if (b.serviceType !== 'food')
      throw new ForbiddenException({
        code: ErrorCode.WRONG_SERVICE,
        message:
          'This is part of MetroMatrix Food; your business is registered for another service.',
        details: { required: 'food', actual: b.serviceType },
      });
    return this.vendors.ensureForBusinessId(b.id);
  }

  /** Customer screens: a customer with a verified email. */
  assertCustomer(user: AuthenticatedUser): void {
    if (user.role !== 'customer')
      throw new ForbiddenException({
        code: ErrorCode.FORBIDDEN,
        message: 'This screen is for customers.',
      });
    assertEmailVerified(user);
  }
}
