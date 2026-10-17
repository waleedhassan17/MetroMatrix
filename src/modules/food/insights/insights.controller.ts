import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { FoodInsightsService, InsightsQueryDto } from './insights.service';
import { FoodVendor } from '../common/food-roles.decorator';
import { CurrentVendor } from '../common/current-vendor.decorator';
import type { VendorRef } from '../vendor/food-vendor.service';

@ApiTags('food · vendor')
@FoodVendor()
@Controller('food/vendor/insights')
export class VendorInsightsController {
  constructor(private readonly insights: FoodInsightsService) {}

  @Get()
  @ApiOperation({
    summary:
      '?range=today|7d|30d (or from/to local dates): orders/day, recorded sales/day, acceptance rate, avg accept time, avg prep, on-time %, cancel reasons, top items, repeat customers.',
  })
  get(@CurrentVendor() v: VendorRef, @Query() q: InsightsQueryDto) {
    return this.insights.insights(v, q);
  }
}
