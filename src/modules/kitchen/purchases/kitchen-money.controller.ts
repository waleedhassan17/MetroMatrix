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
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { FoodVendor } from '../../food/common/food-roles.decorator';
import { CurrentVendor } from '../../food/common/current-vendor.decorator';
import type { VendorRef } from '../../food/vendor/food-vendor.service';
import {
  IngredientMappingDto,
  KitchenSettingsDto,
  PurchaseDto,
  PurchasesQueryDto,
  ScanDto,
  SupplierDto,
  UpdatePurchaseDto,
  UpdateSupplierDto,
  WasteDto,
  WasteQueryDto,
  WasteSummaryQueryDto,
} from '../dto/purchase.dto';
import { PurchasesService } from './purchases.service';
import { ReceiptScanService } from './receipt-scan.service';
import { CostingService } from '../costing/costing.service';
import { PriceWatchService } from '../costing/price-watch.service';
import { WasteService } from '../waste/waste.service';
import { InsightCardsService } from '../insights/insight-cards.service';

/**
 * Kitchen money (Chunk 5, P2): suppliers, purchases, receipt scan, costing,
 * price watch, waste and insight cards. Another vendor's rows are 404.
 */
@ApiTags('kitchen · purchases & costing')
@FoodVendor()
@Controller('food/vendor/kitchen')
export class KitchenMoneyController {
  constructor(
    private readonly purchases: PurchasesService,
    private readonly scanner: ReceiptScanService,
    private readonly costing: CostingService,
    private readonly priceWatch: PriceWatchService,
    private readonly waste: WasteService,
    private readonly insights: InsightCardsService,
    private readonly dataSource: DataSource,
  ) {}

  // Settings
  @Get('settings')
  async settings(@CurrentVendor() v: VendorRef) {
    const [b] = await this.dataSource.query(
      `SELECT target_food_cost_pct, require_packing_photo FROM branches WHERE id = $1`,
      [v.branchId],
    );
    return {
      targetFoodCostPct: b.target_food_cost_pct,
      requirePackingPhoto: b.require_packing_photo,
    };
  }

  @Patch('settings')
  @ApiOperation({
    summary: '{ targetFoodCostPct? (5–95, default 35), requirePackingPhoto? }',
  })
  async patchSettings(
    @CurrentVendor() v: VendorRef,
    @Body() dto: KitchenSettingsDto,
  ) {
    await this.dataSource.query(
      `UPDATE branches SET target_food_cost_pct = coalesce($2, target_food_cost_pct),
              require_packing_photo = coalesce($3, require_packing_photo), updated_at = now() WHERE id = $1`,
      [
        v.branchId,
        dto.targetFoodCostPct ?? null,
        dto.requirePackingPhoto ?? null,
      ],
    );
    return this.settings(v);
  }

  // Suppliers
  @Get('suppliers')
  suppliers(@CurrentVendor() v: VendorRef) {
    return this.purchases.suppliers(v);
  }

  @Post('suppliers')
  createSupplier(@CurrentVendor() v: VendorRef, @Body() dto: SupplierDto) {
    return this.purchases.createSupplier(v, dto);
  }

  @Patch('suppliers/:id')
  updateSupplier(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupplierDto,
  ) {
    return this.purchases.updateSupplier(v, id, dto);
  }

  @Delete('suppliers/:id')
  removeSupplier(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.purchases.removeSupplier(v, id);
  }

  // Purchases
  @Get('purchases')
  list(@CurrentVendor() v: VendorRef, @Query() q: PurchasesQueryDto) {
    return this.purchases.list(v, q);
  }

  @Post('purchases')
  @ApiOperation({
    summary:
      '{ supplierId?, purchasedAt?, receiptUrl?, source?, note?, lines: [{ ingredientId, qty, unit, totalPrice, expiresOn? }] } — each line a batch, a movement and a new average cost.',
  })
  create(@CurrentVendor() v: VendorRef, @Body() dto: PurchaseDto) {
    return this.purchases.create(v, dto);
  }

  @Post('purchases/scan')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary:
      '{ imageUrl } (a `receipt` upload) → draft lines matched to your ingredients; nothing is saved. 503 AI_UNAVAILABLE / 429 AI_QUOTA_REACHED → type the lines.',
  })
  scan(@CurrentVendor() v: VendorRef, @Body() dto: ScanDto) {
    return this.scanner.scan(v, dto);
  }

  @Get('purchases/:id')
  get(@CurrentVendor() v: VendorRef, @Param('id', ParseUUIDPipe) id: string) {
    return this.purchases.get(v, id);
  }

  @Patch('purchases/:id')
  @ApiOperation({
    summary:
      'Supplier, date or note. Lines are fixed: delete and re-enter, or count.',
  })
  update(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePurchaseDto,
  ) {
    return this.purchases.update(v, id, dto);
  }

  @Delete('purchases/:id')
  @ApiOperation({
    summary:
      'Only while none of it has been used (else 409 — log a count instead).',
  })
  remove(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.purchases.remove(v, id);
  }

  // Costing and price watch
  @Get('costing')
  @ApiOperation({
    summary:
      'Every dish and size: price, cost per serving, food cost %, margin, week-on-week trend.',
  })
  costingView(@CurrentVendor() v: VendorRef) {
    return this.costing.view(v);
  }

  @Get('price-watch')
  @ApiOperation({
    summary:
      'Your last price against the PBS weekly city price (SPI): flags > 15% above, or the city price up > 10% in a week; mapping suggestions.',
  })
  watch(@CurrentVendor() v: VendorRef) {
    return this.priceWatch.view(v);
  }

  @Get('price-watch/reference-items')
  referenceItems(@Query('q') q?: string) {
    return this.priceWatch.referenceItems(q?.slice(0, 80));
  }

  @Patch('ingredients/:id/reference')
  @ApiOperation({
    summary:
      '{ referenceItemId | null } — the SPI item this ingredient is compared with.',
  })
  map(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: IngredientMappingDto,
  ) {
    return this.priceWatch.map(v, id, dto.referenceItemId);
  }

  // Waste
  @Get('waste')
  wasteList(@CurrentVendor() v: VendorRef, @Query() q: WasteQueryDto) {
    return this.waste.list(v, q);
  }

  @Post('waste')
  @ApiOperation({
    summary:
      '{ ingredientId | menuItemId, qty, unit ("serving" for a dish), reason, note? } — taken out of stock; cost at the batches’ cost.',
  })
  logWaste(@CurrentVendor() v: VendorRef, @Body() dto: WasteDto) {
    return this.waste.log(v, dto);
  }

  @Get('waste/summary')
  wasteSummary(
    @CurrentVendor() v: VendorRef,
    @Query() q: WasteSummaryQueryDto,
  ) {
    return this.waste.summary(v, q);
  }

  // Insight cards
  @Get('insights/cards')
  @ApiOperation({
    summary:
      'What needs attention, most urgent first: expiring stock, food cost above target or rising, price spikes, dishes sold out by stock, negative stock, waste spikes — each with a deep link.',
  })
  cards(@CurrentVendor() v: VendorRef) {
    return this.insights.cards(v);
  }
}
