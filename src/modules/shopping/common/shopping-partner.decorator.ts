import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Roles } from '../../../common/decorators/roles.decorator';
import { BusinessApprovedGuard } from '../../../common/guards/business-approved.guard';
import { ServiceTypeGuard } from '../../../common/guards/service-type.guard';
import { PartnerStoreGuard } from './partner-store.guard';

export const ShoppingServiceGuard = ServiceTypeGuard('shopping');

/**
 * Every /shop/partner route: a partner (403 FORBIDDEN otherwise) whose
 * business is approved (403 BUSINESS_NOT_APPROVED / BUSINESS_SUSPENDED) and
 * registered for Shopping (403 WRONG_SERVICE). Read the store with
 * @CurrentStore().
 */
export const ShoppingPartner = () =>
  applyDecorators(
    ApiBearerAuth(),
    Roles('partner'),
    UseGuards(BusinessApprovedGuard, ShoppingServiceGuard, PartnerStoreGuard),
  );
