import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Matches } from 'class-validator';
import { FoodVendor } from '../../food/common/food-roles.decorator';
import { CurrentVendor } from '../../food/common/current-vendor.decorator';
import type { VendorRef } from '../../food/vendor/food-vendor.service';
import { InsightCardsService } from './insight-cards.service';
import { KitchenHubService } from './kitchen-hub.service';

export class CardKeyParams {
  /** A card's `key`, e.g. `expiring_stock:<ingredientId>`. */
  @Matches(/^[a-z_]{2,40}(:[0-9a-f-]{36}){0,3}$/, {
    message: 'key: a card key from GET /insights/cards',
  })
  key!: string;
}

/** The Kitchen tab's numbers, the board's kitchen side, and putting a card away. */
@ApiTags('kitchen · hub')
@FoodVendor()
@Controller('food/vendor/kitchen')
export class KitchenHubController {
  constructor(
    private readonly hub: KitchenHubService,
    private readonly insights: InsightCardsService,
  ) {}

  @Get('summary')
  @ApiOperation({
    summary:
      'The Kitchen tab’s numbers: stock, costing, this week’s purchases, tomorrow’s forecast, the week’s waste and meals rescued, and growth (tiffin, catering, storefront, demand, experiments, hygiene, Ramadan).',
  })
  summary(@CurrentVendor() v: VendorRef) {
    return this.hub.summary(v);
  }

  @Get('board')
  @ApiOperation({
    summary:
      'The board’s kitchen side: dishes the stock makes 5 servings or fewer of, dishes sold out by stock, the prep time quotes use now, and the packing-photo rule.',
  })
  board(@CurrentVendor() v: VendorRef) {
    return this.hub.board(v);
  }

  @Post('insights/cards/:key/snooze')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Put a card away for 24 hours (by its key) → { key, snoozedUntil }. It comes back after that if it still applies.',
  })
  snooze(@CurrentVendor() v: VendorRef, @Param() p: CardKeyParams) {
    return this.insights.snooze(v, p.key);
  }
}
