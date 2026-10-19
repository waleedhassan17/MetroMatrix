import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { FoodCustomer, FoodVendor } from '../food/common/food-roles.decorator';
import { CurrentVendor } from '../food/common/current-vendor.decorator';
import type { VendorRef } from '../food/vendor/food-vendor.service';
import {
  FoodsQueryDto,
  HideNutritionDto,
  MapIngredientDto,
  NutritionProfileDto,
  SummaryQueryDto,
} from './dto/nutrition.dto';
import { NutritionMappingService } from './nutrition-mapping.service';
import { ItemNutritionService } from './item-nutrition.service';
import { NutritionProfileService } from './nutrition-profile.service';

/** Nutrition — the vendor side (Chunk 5, P10). Another kitchen's ingredient or dish is 404. */
@ApiTags('kitchen · nutrition')
@FoodVendor()
@Controller('food/vendor/kitchen/nutrition')
export class VendorNutritionController {
  constructor(
    private readonly mapping: NutritionMappingService,
    private readonly items: ItemNutritionService,
  ) {}

  @Get('foods')
  @ApiOperation({
    summary: '?q&page — the reference foods (per 100 g; USDA SR Legacy).',
  })
  foods(@Query() q: FoodsQueryDto) {
    return this.mapping.foods(q);
  }

  @Get('mapping')
  @ApiOperation({
    summary:
      'Each ingredient: confirmed food, suggestion (by alias or name), unmapped or not food. Only confirmed mappings count.',
  })
  map(@CurrentVendor() v: VendorRef) {
    return this.mapping.mapping(v);
  }

  @Put('mapping/:ingredientId')
  @ApiOperation({
    summary:
      '{ nutritionFoodId | null, pieceGrams? } — confirm (or clear); your dishes are recomputed.',
  })
  setMapping(
    @CurrentVendor() v: VendorRef,
    @Param('ingredientId', ParseUUIDPipe) id: string,
    @Body() dto: MapIngredientDto,
  ) {
    return this.mapping.map(v, id, dto);
  }

  @Post('mapping/accept-suggestions')
  @HttpCode(200)
  acceptAll(@CurrentVendor() v: VendorRef) {
    return this.mapping.acceptAll(v);
  }

  @Get('items')
  list(@CurrentVendor() v: VendorRef, @Query() q: PaginationQueryDto) {
    return this.items.list(v, q);
  }

  @Get('items/:itemId')
  @ApiOperation({
    summary:
      'Per serving, from the recipe when ≥ 80% of its weight is mapped; what is unmapped otherwise.',
  })
  item(
    @CurrentVendor() v: VendorRef,
    @Param('itemId', ParseUUIDPipe) id: string,
  ) {
    return this.items.view(v, id);
  }

  @Post('items/:itemId/estimate')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'No usable recipe: an AI estimate from the name, description and portion (labelled low confidence).',
  })
  estimate(
    @CurrentVendor() v: VendorRef,
    @Param('itemId', ParseUUIDPipe) id: string,
  ) {
    return this.items.estimate(v, id);
  }

  @Patch('items/:itemId')
  @ApiOperation({
    summary: '{ hidden } — hide (or show) the dish’s nutrition from customers.',
  })
  hide(
    @CurrentVendor() v: VendorRef,
    @Param('itemId', ParseUUIDPipe) id: string,
    @Body() dto: HideNutritionDto,
  ) {
    return this.items.hide(v, id, dto.hidden);
  }
}

/**
 * The customer's nutrition profile (opt-in) and ordered-food summary. A
 * profile exists only for its customer: anyone else — a vendor included —
 * gets 404, and DELETE removes it.
 */
@ApiTags('food · nutrition')
@Controller('food/me/nutrition')
export class CustomerNutritionController {
  constructor(private readonly profiles: NutritionProfileService) {}

  @Get('profile')
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.profiles.get(user);
  }

  @Put('profile')
  @FoodCustomer()
  @ApiOperation({
    summary:
      '{ goal, sex?, age?, heightCm?, weightKg?, activity? } (Mifflin-St Jeor) or { goal, manualTargetKcal }.',
  })
  put(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: NutritionProfileDto,
  ) {
    return this.profiles.put(user, dto);
  }

  @Delete('profile')
  remove(@CurrentUser() user: AuthenticatedUser) {
    return this.profiles.remove(user);
  }

  @Get('summary')
  @FoodCustomer()
  @ApiOperation({
    summary:
      '?range=7d|30d — per day from delivered food orders (estimated; ordered food only, not total intake), with your target.',
  })
  summary(@CurrentUser() user: AuthenticatedUser, @Query() q: SummaryQueryDto) {
    return this.profiles.summary(user, q.range);
  }
}
