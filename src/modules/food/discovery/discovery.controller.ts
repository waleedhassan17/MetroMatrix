import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { FoodDiscoveryService } from './discovery.service';
import {
  OptionalPointQueryDto,
  PointQueryDto,
  SearchQueryDto,
  VendorQueryDto,
} from './dto/discovery.dto';
import { OptionalAuth } from '../../../common/decorators/optional-auth.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';

@ApiTags('food · discovery')
@OptionalAuth()
@Throttle({ default: { limit: 600, ttl: 60_000 } })
@Controller('food')
export class FoodDiscoveryController {
  constructor(private readonly discovery: FoodDiscoveryService) {}

  @Get('home')
  @ApiOperation({
    summary:
      '?lat&lng → { coverage, cuisines, banners, orderAgain (signed in), offers, homeKitchens, topRated, fastest, newOnFoodCourt, freeDelivery } (vendor cards).',
  })
  home(@Query() q: PointQueryDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.discovery.home(
      { lat: q.lat, lng: q.lng },
      user?.role === 'customer' ? user.id : null,
    );
  }

  @Get('vendors')
  @ApiOperation({
    summary:
      '?lat&lng (required) &q&cuisine&sort=recommended|distance|rating|delivery_time|delivery_fee&freeDelivery&offers&minRating&pickup&homeKitchen&openNow&priceLevel&page — vendors that deliver to the point (pickup=true: that you can collect from). Open vendors first.',
  })
  list(@Query() q: VendorQueryDto) {
    return this.discovery.list(q);
  }

  @Get('vendors/:slug')
  @ApiOperation({
    summary:
      '?lat&lng (optional; enables fee/ETA/zone) — open state (a paused vendor still opens, with its message), fulfilment, quote, deals, rating summary, full menu, popular.',
  })
  vendor(@Param('slug') slug: string, @Query() q: OptionalPointQueryDto) {
    return this.discovery.vendor(slug, q);
  }

  @Get('items/:id')
  @ApiOperation({
    summary:
      'The item sheet: variants and their option groups, with availability.',
  })
  item(@Param('id', ParseUUIDPipe) id: string) {
    return this.discovery.item(id);
  }

  @Get('search')
  @ApiOperation({
    summary:
      '?q&lat&lng → { vendors, dishes: [{ vendor, items }] } — dishes grouped by vendor.',
  })
  search(@Query() q: SearchQueryDto) {
    return this.discovery.search(q.q, { lat: q.lat, lng: q.lng });
  }
}
