import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Roles } from '../../../common/decorators/roles.decorator';
import { BusinessApprovedGuard } from '../../../common/guards/business-approved.guard';
import { EmailVerifiedGuard } from '../../../common/guards/email-verified.guard';
import { ServiceTypeGuard } from '../../../common/guards/service-type.guard';
import { VendorGuard } from './vendor.guard';
import { RiderGuard } from './rider.guard';

export const FoodServiceGuard = ServiceTypeGuard('food');

/** /food/vendor routes: an approved food partner; @CurrentVendor() gives brand + branch. */
export const FoodVendor = () =>
  applyDecorators(
    ApiBearerAuth(),
    Roles('partner'),
    UseGuards(BusinessApprovedGuard, FoodServiceGuard, VendorGuard),
  );

/** Customer routes: a signed-in customer with a verified email. */
export const FoodCustomer = () =>
  applyDecorators(
    ApiBearerAuth(),
    Roles('customer'),
    UseGuards(EmailVerifiedGuard),
  );

/** /food/rider routes: an active rider of an approved vendor; @CurrentRider(). */
export const FoodRider = () =>
  applyDecorators(ApiBearerAuth(), Roles('rider'), UseGuards(RiderGuard));
