import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { PublicRoute } from '../../../common/decorators/public.decorator';
import { FoodVendor } from '../../food/common/food-roles.decorator';
import { CurrentVendor } from '../../food/common/current-vendor.decorator';
import type { VendorRef } from '../../food/vendor/food-vendor.service';
import { StorefrontService } from './storefront.service';

export class StorefrontQueryDto {
  @ApiPropertyOptional({ default: 30, minimum: 7, maximum: 90 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(7)
  @Max(90)
  days: number = 30;
}

/** The public storefront page (Chunk 5, P7): no sign-in. */
@ApiTags('growth · storefront')
@PublicRoute()
@Throttle({ default: { limit: 300, ttl: 60_000 } })
@Controller('public/food/store')
export class PublicStorefrontController {
  constructor(private readonly storefront: StorefrontService) {}

  @Get(':slug')
  @ApiOperation({
    summary:
      'The vendor page (info, open state, menu, story, badges) for the web storefront at /s/:slug. Paused vendors still open; unknown or hidden ones are 404.',
  })
  store(@Param('slug') slug: string) {
    return this.storefront.store(slug);
  }
}

@ApiTags('growth · storefront')
@FoodVendor()
@Controller('food/vendor/storefront')
export class VendorStorefrontController {
  constructor(private readonly storefront: StorefrontService) {}

  @Get()
  @ApiOperation({
    summary:
      '?days (30) → { url, links, qr: { payload }, ordersYouBrought: { orders, revenue, customers, newCustomers, share, storefront, qr, campaigns }, bySource }',
  })
  get(@CurrentVendor() v: VendorRef, @Query() q: StorefrontQueryDto) {
    return this.storefront.vendor(v, q.days);
  }
}
