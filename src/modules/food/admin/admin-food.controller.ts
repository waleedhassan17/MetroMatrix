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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminFoodService } from './admin-food.service';
import { FoodBannersService } from './food-banners.service';
import { FoodReviewsService } from '../reviews/food-reviews.service';
import {
  AdminFoodOrdersQueryDto,
  AdminFoodVendorsQueryDto,
  AdminReasonDto,
  CuisineDto,
  FoodBannerDto,
  UpdateCuisineDto,
  UpdateFoodBannerDto,
} from './dto/admin-food.dto';
import {
  AdminFoodReviewsQueryDto,
  HideReviewDto,
} from '../reviews/dto/review.dto';
import { Roles } from '../../../common/decorators/roles.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';

/** Staff on Food Court. Every write is audited. */
@ApiTags('admin · food')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@Controller('admin/food')
export class AdminFoodController {
  constructor(
    private readonly food: AdminFoodService,
    private readonly banners: FoodBannersService,
    private readonly reviews: FoodReviewsService,
  ) {}

  @Get('overview')
  @ApiOperation({
    summary:
      'Live vendors by type, orders today, acceptance rate, auto-rejects, top cuisines, what is waiting on staff.',
  })
  overview() {
    return this.food.overview();
  }

  // ── vendors ──
  @Get('vendors')
  @ApiOperation({ summary: '?type&status=live|draft|paused|suspended&city&q' })
  vendors(@Query() q: AdminFoodVendorsQueryDto) {
    return this.food.listVendors(q);
  }

  @Get('vendors/:id')
  @ApiOperation({
    summary:
      'Profile, settings, hours, zones, setup, plan, menu (read-only), recent orders, ratings, complaints (≤ 2★).',
  })
  vendor(@Param('id', ParseUUIDPipe) id: string) {
    return this.food.vendor(id);
  }

  @Post('vendors/:id/feature')
  @HttpCode(200)
  feature(@Param('id', ParseUUIDPipe) id: string) {
    return this.food.setFeatured(id, true);
  }

  @Post('vendors/:id/unfeature')
  @HttpCode(200)
  unfeature(@Param('id', ParseUUIDPipe) id: string) {
    return this.food.setFeatured(id, false);
  }

  @Post('vendors/:id/suspend')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Suspends the business: hidden at once; the vendor and every customer with an active order are told.',
  })
  suspend(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminReasonDto,
  ) {
    return this.food.suspend(me, id, dto.reason);
  }

  @Post('vendors/:id/reinstate')
  @HttpCode(200)
  reinstate(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminReasonDto,
  ) {
    return this.food.reinstate(me, id, dto.reason);
  }

  // ── orders (read-only, for disputes) ──
  @Get('orders')
  @ApiOperation({ summary: '?code&vendorId&status' })
  orders(@Query() q: AdminFoodOrdersQueryDto) {
    return this.food.orders(q);
  }

  @Get('orders/:id')
  @ApiOperation({ summary: 'The order with every event.' })
  order(@Param('id', ParseUUIDPipe) id: string) {
    return this.food.order(id);
  }

  // ── reviews ──
  @Get('reviews')
  @ApiOperation({ summary: '?vendorId&hidden&maxRating' })
  reviewList(@Query() q: AdminFoodReviewsQueryDto) {
    return this.reviews.adminList(q);
  }

  @Post('reviews/:id/hide')
  @HttpCode(200)
  hide(@Param('id', ParseUUIDPipe) id: string, @Body() dto: HideReviewDto) {
    return this.reviews.setHidden(id, true, dto.reason);
  }

  @Post('reviews/:id/unhide')
  @HttpCode(200)
  unhide(@Param('id', ParseUUIDPipe) id: string) {
    return this.reviews.setHidden(id, false, null);
  }

  // ── cuisines ──
  @Get('cuisines')
  cuisines() {
    return this.food.cuisines();
  }

  @Post('cuisines')
  createCuisine(@Body() dto: CuisineDto) {
    return this.food.createCuisine(dto);
  }

  @Patch('cuisines/:id')
  updateCuisine(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCuisineDto,
  ) {
    return this.food.updateCuisine(id, dto);
  }

  @Delete('cuisines/:id')
  @ApiOperation({
    summary: 'Only when no vendor uses it (otherwise deactivate).',
  })
  removeCuisine(@Param('id', ParseUUIDPipe) id: string) {
    return this.food.removeCuisine(id);
  }

  // ── banners ──
  @Get('banners')
  bannerList() {
    return this.banners.list();
  }

  @Post('banners')
  @ApiOperation({
    summary:
      'Image from a `banner` upload; target vendor | cuisine | search; optional city and dates.',
  })
  createBanner(
    @CurrentUser() me: AuthenticatedUser,
    @Body() dto: FoodBannerDto,
  ) {
    return this.banners.create(me.id, dto);
  }

  @Patch('banners/:id')
  updateBanner(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFoodBannerDto,
  ) {
    return this.banners.update(me.id, id, dto);
  }

  @Delete('banners/:id')
  removeBanner(@Param('id', ParseUUIDPipe) id: string) {
    return this.banners.remove(id);
  }
}
