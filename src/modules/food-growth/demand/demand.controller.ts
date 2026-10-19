import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { FoodVendor } from '../../food/common/food-roles.decorator';
import { CurrentVendor } from '../../food/common/current-vendor.decorator';
import type { VendorRef } from '../../food/vendor/food-vendor.service';
import { DemandCurveQueryDto, DemandMapQueryDto } from './dto/demand.dto';
import { DemandService } from './demand.service';

/** Demand data for vendors (Chunk 5, P8): anonymous and k-thresholded. */
@ApiTags('growth · demand')
@FoodVendor()
@Controller('food/vendor')
export class VendorDemandController {
  constructor(private readonly demand: DemandService) {}

  @Get('demand-map')
  @ApiOperation({
    summary:
      '?cuisineId&hour&week — your city’s geohash6 cells (≈ 1.2 km) with searches, zero-result and closed shares and orders, most unmet first; cells under 5 searches are hidden (`hidden` counts them). Plus the top unmet queries.',
  })
  map(@CurrentVendor() v: VendorRef, @Query() q: DemandMapQueryDto) {
    return this.demand.vendorMap(v, q);
  }

  @Get('demand-curve')
  @ApiOperation({
    summary:
      '?weeks (8) — orders per weekday × hour: yours, and anonymously the city’s other kitchens that share a cuisine with you (only when there are at least 3).',
  })
  curve(@CurrentVendor() v: VendorRef, @Query() q: DemandCurveQueryDto) {
    return this.demand.curve(v, q.weeks);
  }
}
