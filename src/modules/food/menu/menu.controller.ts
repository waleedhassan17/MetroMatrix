import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseArrayPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { MenuService } from './menu.service';
import { MenuAvailabilityService } from './menu-availability.service';
import {
  AvailabilityPatchDto,
  CategoryDto,
  ItemDto,
  ItemGroupLinkDto,
  OptionGroupDto,
  PreorderSlotDto,
  ReorderDto,
  TodayPatchDto,
  UpdateCategoryDto,
  UpdateItemDto,
  VariantDto,
  WeeklyMenuEntryDto,
} from './dto/menu.dto';
import type { VendorRef } from '../vendor/food-vendor.service';
import { FoodVendor } from '../common/food-roles.decorator';
import { CurrentVendor } from '../common/current-vendor.decorator';
import { validationExceptionFactory } from '../../../common/validation/validation-exception.factory';

const arrayOf = <T>(items: new () => T) =>
  new ParseArrayPipe({
    items,
    whitelist: true,
    forbidNonWhitelisted: true,
    exceptionFactory: validationExceptionFactory,
  });

@ApiTags('food · vendor menu')
@FoodVendor()
@Controller('food/vendor')
export class VendorMenuController {
  constructor(
    private readonly menu: MenuService,
    private readonly availabilityService: MenuAvailabilityService,
  ) {}

  // Categories
  @Get('menu/categories')
  categories(@CurrentVendor() v: VendorRef) {
    return this.menu.categories(v);
  }

  @Post('menu/categories')
  @ApiOperation({
    summary:
      '{ name, availableFrom?, availableTo? (daily window, local), isActive? }',
  })
  createCategory(@CurrentVendor() v: VendorRef, @Body() dto: CategoryDto) {
    return this.menu.createCategory(v, dto);
  }

  @Put('menu/categories/reorder')
  reorderCategories(@CurrentVendor() v: VendorRef, @Body() dto: ReorderDto) {
    return this.menu.reorder(v, 'categories', dto.ids);
  }

  @Patch('menu/categories/:id')
  updateCategory(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.menu.updateCategory(v, id, dto);
  }

  @Delete('menu/categories/:id')
  @ApiOperation({ summary: '409 while it still has items.' })
  removeCategory(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.menu.removeCategory(v, id);
  }

  // Items
  @Get('menu/items')
  @ApiQuery({ name: 'categoryId', required: false })
  items(
    @CurrentVendor() v: VendorRef,
    @Query('categoryId') categoryId?: string,
  ) {
    return this.menu.items(v, { categoryId });
  }

  @Post('menu/items')
  @ApiOperation({
    summary:
      '{ categoryId, name, description?, photoUrl? (purpose menu_item), basePrice, tags?, isDeal?, serves?, days? (weekdays), variants? [{ name, price }] } — plan limit menu_items.',
  })
  createItem(@CurrentVendor() v: VendorRef, @Body() dto: ItemDto) {
    return this.menu.createItem(v, dto);
  }

  @Put('menu/items/reorder')
  reorderItems(@CurrentVendor() v: VendorRef, @Body() dto: ReorderDto) {
    return this.menu.reorder(v, 'items', dto.ids);
  }

  @Get('menu/items/:id')
  item(@CurrentVendor() v: VendorRef, @Param('id', ParseUUIDPipe) id: string) {
    return this.menu.item(v, id);
  }

  @Patch('menu/items/:id')
  updateItem(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateItemDto,
  ) {
    return this.menu.updateItem(v, id, dto);
  }

  @Delete('menu/items/:id')
  removeItem(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.menu.removeItem(v, id);
  }

  @Post('menu/items/:id/duplicate')
  @ApiOperation({
    summary: 'An inactive copy with the same variants and option groups.',
  })
  duplicate(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.menu.duplicateItem(v, id);
  }

  @Put('menu/items/:id/variants')
  @ApiBody({ type: [VariantDto] })
  @ApiOperation({
    summary:
      '[{ id?, name, price }] replaces the variants (keep existing ones by id).',
  })
  variants(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(arrayOf(VariantDto)) variants: VariantDto[],
  ) {
    return this.menu.replaceVariants(v, id, variants);
  }

  @Put('menu/items/:id/option-groups')
  @ApiBody({ type: [ItemGroupLinkDto] })
  @ApiOperation({
    summary:
      '[{ groupId, variantId? }] in display order — replaces the item’s groups.',
  })
  linkGroups(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(arrayOf(ItemGroupLinkDto)) links: ItemGroupLinkDto[],
  ) {
    return this.menu.linkGroups(v, id, links);
  }

  // Option groups
  @Get('menu/option-groups')
  groups(@CurrentVendor() v: VendorRef) {
    return this.menu.groups(v);
  }

  @Post('menu/option-groups')
  @ApiOperation({
    summary:
      '{ name, minSelect, maxSelect, options: [{ name, priceDelta, isDefault? }] } — required when minSelect ≥ 1; reusable across items.',
  })
  createGroup(@CurrentVendor() v: VendorRef, @Body() dto: OptionGroupDto) {
    return this.menu.createGroup(v, dto);
  }

  @Get('menu/option-groups/:id')
  group(@CurrentVendor() v: VendorRef, @Param('id', ParseUUIDPipe) id: string) {
    return this.menu.group(v, id);
  }

  @Put('menu/option-groups/:id')
  updateGroup(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OptionGroupDto,
  ) {
    return this.menu.updateGroup(v, id, dto);
  }

  @Delete('menu/option-groups/:id')
  removeGroup(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.menu.removeGroup(v, id);
  }

  // Availability
  @Get('availability')
  availability(@CurrentVendor() v: VendorRef) {
    return this.availabilityService.availability(v);
  }

  @Patch('availability')
  @ApiOperation({
    summary:
      '{ items?: [{ itemId, isAvailable, unavailableUntil? }], options?: [{ optionId, isAvailable }] } — 86 an item or option.',
  })
  patchAvailability(
    @CurrentVendor() v: VendorRef,
    @Body() dto: AvailabilityPatchDto,
  ) {
    return this.availabilityService.patch(v, dto);
  }

  // Home kitchens
  @Get('today')
  today(@CurrentVendor() v: VendorRef) {
    return this.availabilityService.today(v);
  }

  @Patch('today')
  @ApiOperation({
    summary:
      '{ items: [{ itemId, portions?, cooking? }] } — portions reset what is left today.',
  })
  patchToday(@CurrentVendor() v: VendorRef, @Body() dto: TodayPatchDto) {
    return this.availabilityService.patchToday(v, dto);
  }

  @Get('preorder-slots')
  slots(@CurrentVendor() v: VendorRef) {
    return this.availabilityService.slots(v);
  }

  @Put('preorder-slots')
  @ApiBody({ type: [PreorderSlotDto] })
  replaceSlots(
    @CurrentVendor() v: VendorRef,
    @Body(arrayOf(PreorderSlotDto)) slots: PreorderSlotDto[],
  ) {
    return this.availabilityService.replaceSlots(v, slots);
  }

  @Put('weekly-menu')
  @HttpCode(200)
  @ApiBody({ type: [WeeklyMenuEntryDto] })
  @ApiOperation({
    summary: '[{ itemId, days }] — which weekdays each dish is on.',
  })
  weeklyMenu(
    @CurrentVendor() v: VendorRef,
    @Body(arrayOf(WeeklyMenuEntryDto)) entries: WeeklyMenuEntryDto[],
  ) {
    return this.availabilityService.weeklyMenu(v, entries);
  }
}
