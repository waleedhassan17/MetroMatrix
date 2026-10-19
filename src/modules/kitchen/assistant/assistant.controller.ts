import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { FoodVendor } from '../../food/common/food-roles.decorator';
import { CurrentVendor } from '../../food/common/current-vendor.decorator';
import type { VendorRef } from '../../food/vendor/food-vendor.service';
import {
  CreateSpecialDto,
  DescribeDto,
  PhotoCheckDto,
} from '../dto/assistant.dto';
import { MenuAssistantService } from './menu-assistant.service';
import { ReviewInsightsService } from '../reviews/review-insights.service';

/**
 * The menu assistant and review insights (Chunk 5, P9). Every AI answer is a
 * draft; the only write here is "create this special" (an inactive dish).
 */
@ApiTags('kitchen · menu assistant')
@FoodVendor()
@Controller('food/vendor/kitchen')
export class KitchenAssistantController {
  constructor(
    private readonly assistant: MenuAssistantService,
    private readonly insights: ReviewInsightsService,
  ) {}

  @Post('ai/describe')
  @HttpCode(200)
  @ApiOperation({
    summary:
      '{ itemId } → { draft: { description, descriptionUr } (≤ 160 each, Urdu script, no health claims or brands), save } — nothing is saved; PATCH the dish to keep it.',
  })
  describe(@CurrentVendor() v: VendorRef, @Body() dto: DescribeDto) {
    return this.assistant.describe(v, dto.itemId);
  }

  @Post('ai/specials')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Ingredients expiring within 3 days → 1–3 special ideas: recipe lines on your own ingredients, cost, a price from your food cost target, and a create draft.',
  })
  specials(@CurrentVendor() v: VendorRef) {
    return this.assistant.specials(v);
  }

  @Post('ai/specials/create')
  @ApiOperation({
    summary:
      'A special’s create body → an inactive dish with its recipe card (switch it on when ready).',
  })
  createSpecial(@CurrentVendor() v: VendorRef, @Body() dto: CreateSpecialDto) {
    return this.assistant.createSpecial(v, dto);
  }

  @Post('ai/combos')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Dishes ordered together (60 days, 3+ orders) with a bundle price and margin; the AI only names them (dish names without AI).',
  })
  combos(@CurrentVendor() v: VendorRef) {
    return this.assistant.combos(v);
  }

  @Post('ai/photo-check')
  @HttpCode(200)
  @ApiOperation({
    summary:
      '{ imageUrl (menu_item upload), itemId? } → measured brightness, contrast, sharpness, framing, size; tips and a score; AI tips when available.',
  })
  photoCheck(@CurrentVendor() v: VendorRef, @Body() dto: PhotoCheckDto) {
    return this.assistant.photoCheck(v, dto);
  }

  @Get('review-insights')
  @ApiOperation({
    summary:
      'The latest themes from your reviews (nightly, once 5 new reviews are in) and the last 8 runs.',
  })
  reviewInsights(@CurrentVendor() v: VendorRef) {
    return this.insights.view(v);
  }
}
