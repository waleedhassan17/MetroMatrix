import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlanService } from '../../plans/plans.service';
import { FoodVendor } from '../common/food-roles.decorator';
import { CurrentVendor } from '../common/current-vendor.decorator';
import type { VendorRef } from '../vendor/food-vendor.service';

@ApiTags('food · vendor')
@FoodVendor()
@Controller('food/vendor/plan')
export class VendorPlanController {
  constructor(private readonly plans: PlanService) {}

  @Get()
  @ApiOperation({
    summary:
      '{ planKey, label, limits, usage, entitlements } — every vendor is on the free Community plan.',
  })
  get(@CurrentVendor() v: VendorRef) {
    return this.plans.view(v.businessId);
  }
}
