import {
  AdminFoodCreateBannerView,
  AdminFoodCreateCuisineView,
  AdminFoodCuisinesView,
  AdminFoodFeatureView,
  AdminFoodHideView,
  AdminFoodOrderView,
  AdminFoodOrdersView,
  AdminFoodOverviewView,
  AdminFoodReinstateView,
  AdminFoodRemoveBannerView,
  AdminFoodRemoveCuisineView,
  AdminFoodReviewListView,
  AdminFoodSuspendView,
  AdminFoodUnfeatureView,
  AdminFoodUnhideView,
  AdminFoodUpdateBannerView,
  AdminFoodUpdateCuisineView,
  AdminFoodVendorView,
  AdminFoodVendorsView,
} from './admin-food.response';
import {
  ApiEnvelopeOk,
  ApiPagedOk,
} from '../../../common/swagger/api-envelope';
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
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';

/** Staff on Food Court. Every write is audited. */
@ApiTags('admin · food')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@RequirePermission('manageFood')
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
  @ApiEnvelopeOk(AdminFoodOverviewView)
  overview() {
    return this.food.overview();
  }

  // ── vendors ──
  @Get('vendors')
  @ApiOperation({ summary: '?type&status=live|draft|paused|suspended&city&q' })
  @ApiPagedOk(AdminFoodVendorsView)
  vendors(@Query() q: AdminFoodVendorsQueryDto) {
    return this.food.listVendors(q);
  }

  @Get('vendors/:id')
  @ApiOperation({
    summary:
      'Profile, settings, hours, zones, setup, plan, menu (read-only), recent orders, ratings, complaints (≤ 2★).',
  })
  @ApiEnvelopeOk(AdminFoodVendorView)
  vendor(@Param('id', ParseUUIDPipe) id: string) {
    return this.food.vendor(id);
  }

  @Post('vendors/:id/feature')
  @HttpCode(200)
  @ApiEnvelopeOk(AdminFoodFeatureView)
  feature(@Param('id', ParseUUIDPipe) id: string) {
    return this.food.setFeatured(id, true);
  }

  @Post('vendors/:id/unfeature')
  @HttpCode(200)
  @ApiEnvelopeOk(AdminFoodUnfeatureView)
  unfeature(@Param('id', ParseUUIDPipe) id: string) {
    return this.food.setFeatured(id, false);
  }

  @Post('vendors/:id/suspend')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Suspends the business: hidden at once; the vendor and every customer with an active order are told.',
  })
  @ApiEnvelopeOk(AdminFoodSuspendView)
  suspend(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminReasonDto,
  ) {
    return this.food.suspend(me, id, dto.reason);
  }

  @Post('vendors/:id/reinstate')
  @HttpCode(200)
  @ApiEnvelopeOk(AdminFoodReinstateView)
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
  @ApiPagedOk(AdminFoodOrdersView)
  orders(@Query() q: AdminFoodOrdersQueryDto) {
    return this.food.orders(q);
  }

  @Get('orders/:id')
  @ApiOperation({ summary: 'The order with every event.' })
  @ApiEnvelopeOk(AdminFoodOrderView)
  order(@Param('id', ParseUUIDPipe) id: string) {
    return this.food.order(id);
  }

  // ── reviews ──
  @Get('reviews')
  @ApiOperation({ summary: '?vendorId&hidden&maxRating' })
  @ApiPagedOk(AdminFoodReviewListView)
  reviewList(@Query() q: AdminFoodReviewsQueryDto) {
    return this.reviews.adminList(q);
  }

  @Post('reviews/:id/hide')
  @HttpCode(200)
  @ApiEnvelopeOk(AdminFoodHideView)
  hide(@Param('id', ParseUUIDPipe) id: string, @Body() dto: HideReviewDto) {
    return this.reviews.setHidden(id, true, dto.reason);
  }

  @Post('reviews/:id/unhide')
  @HttpCode(200)
  @ApiEnvelopeOk(AdminFoodUnhideView)
  unhide(@Param('id', ParseUUIDPipe) id: string) {
    return this.reviews.setHidden(id, false, null);
  }

  // ── cuisines ──
  @Get('cuisines')
  @ApiEnvelopeOk(AdminFoodCuisinesView, { isArray: true })
  cuisines() {
    return this.food.cuisines();
  }

  @Post('cuisines')
  @ApiEnvelopeOk(AdminFoodCreateCuisineView, { status: 201 })
  createCuisine(@Body() dto: CuisineDto) {
    return this.food.createCuisine(dto);
  }

  @Patch('cuisines/:id')
  @ApiEnvelopeOk(AdminFoodUpdateCuisineView)
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
  @ApiEnvelopeOk(AdminFoodRemoveCuisineView)
  removeCuisine(@Param('id', ParseUUIDPipe) id: string) {
    return this.food.removeCuisine(id);
  }

  // ── banners ──
  @RequirePermission('manageContent')
  @Get('banners')
  @ApiEnvelopeOk(AdminFoodCreateBannerView, { isArray: true })
  bannerList() {
    return this.banners.list();
  }

  @RequirePermission('manageContent')
  @Post('banners')
  @ApiOperation({
    summary:
      'Image from a `banner` upload; target vendor | cuisine | search; optional city and dates.',
  })
  @ApiEnvelopeOk(AdminFoodCreateBannerView, { status: 201 })
  createBanner(
    @CurrentUser() me: AuthenticatedUser,
    @Body() dto: FoodBannerDto,
  ) {
    return this.banners.create(me.id, dto);
  }

  @RequirePermission('manageContent')
  @Patch('banners/:id')
  @ApiEnvelopeOk(AdminFoodUpdateBannerView)
  updateBanner(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFoodBannerDto,
  ) {
    return this.banners.update(me.id, id, dto);
  }

  @RequirePermission('manageContent')
  @Delete('banners/:id')
  @ApiEnvelopeOk(AdminFoodRemoveBannerView)
  removeBanner(@Param('id', ParseUUIDPipe) id: string) {
    return this.banners.remove(id);
  }
}
