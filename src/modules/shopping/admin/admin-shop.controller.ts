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
import { AdminShopService } from './admin-shop.service';
import {
  AdminNoteDto,
  AdminOrderQueryDto,
  AdminReasonDto,
  AdminReportQueryDto,
  CreateBannerDto,
  CreateCategoryDto,
  UpdateBannerDto,
  UpdateCategoryDto,
} from './dto/admin-shop.dto';
import { Roles } from '../../../common/decorators/roles.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';

const uuid = new ParseUUIDPipe();

/** MetroMatrix staff tools for Shopping. Every write is audited. */
@ApiTags('admin · shop')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@Controller('admin/shop')
export class AdminShopController {
  constructor(private readonly admin: AdminShopService) {}

  // Categories
  @Get('categories')
  @ApiOperation({ summary: 'The full taxonomy, inactive included.' })
  categories() {
    return this.admin.categories();
  }

  @Post('categories')
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.admin.createCategory(dto);
  }

  @Patch('categories/:id')
  updateCategory(
    @Param('id', uuid) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.admin.updateCategory(id, dto);
  }

  @Delete('categories/:id')
  @ApiOperation({ summary: 'Unused leaves only; deactivate anything in use.' })
  deleteCategory(@Param('id', uuid) id: string) {
    return this.admin.deleteCategory(id);
  }

  // Banners
  @Get('banners')
  banners() {
    return this.admin.banners();
  }

  @Post('banners')
  createBanner(
    @CurrentUser() me: AuthenticatedUser,
    @Body() dto: CreateBannerDto,
  ) {
    return this.admin.createBanner(me.id, dto);
  }

  @Patch('banners/:id')
  updateBanner(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateBannerDto,
  ) {
    return this.admin.updateBanner(me.id, id, dto);
  }

  @Delete('banners/:id')
  deleteBanner(@Param('id', uuid) id: string) {
    return this.admin.deleteBanner(id);
  }

  // Stores
  @Post('stores/:id/feature')
  @HttpCode(200)
  feature(@Param('id', uuid) id: string) {
    return this.admin.setFeatured(id, true);
  }

  @Post('stores/:id/unfeature')
  @HttpCode(200)
  unfeature(@Param('id', uuid) id: string) {
    return this.admin.setFeatured(id, false);
  }

  // Reports
  @Get('reports')
  @ApiOperation({
    summary:
      'Product reports: ?status=open|dismissed|actioned (default open), oldest first.',
  })
  reports(@Query() q: AdminReportQueryDto) {
    return this.admin.reports(q);
  }

  @Post('reports/:id/dismiss')
  @HttpCode(200)
  dismiss(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body() dto: AdminNoteDto,
  ) {
    return this.admin.dismissReport(me.id, id, dto.note ?? null);
  }

  // Products
  @Post('products/:id/remove')
  @HttpCode(200)
  @ApiOperation({
    summary:
      '{ reason } — hidden everywhere; open reports actioned; store notified; orders intact.',
  })
  remove(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body() dto: AdminReasonDto,
  ) {
    return this.admin.removeProduct(me.id, id, dto.reason);
  }

  @Post('products/:id/restore')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Back to active (or draft if it no longer has a photo and an active variant).',
  })
  restore(@Param('id', uuid) id: string) {
    return this.admin.restoreProduct(id);
  }

  // Orders (read-only)
  @Get('orders')
  @ApiOperation({
    summary: 'Dispute lookup: ?code&storeId&status&page. Read-only.',
  })
  orders(@Query() q: AdminOrderQueryDto) {
    return this.admin.orders(q);
  }

  @Get('orders/:id')
  order(@Param('id', uuid) id: string) {
    return this.admin.order(id);
  }

  // Reviews
  @Post('reviews/:id/hide')
  @HttpCode(200)
  hideReview(@Param('id', uuid) id: string, @Body() dto: AdminReasonDto) {
    return this.admin.hideReview(id, dto.reason);
  }

  @Post('reviews/:id/unhide')
  @HttpCode(200)
  unhideReview(@Param('id', uuid) id: string) {
    return this.admin.unhideReview(id);
  }
}
