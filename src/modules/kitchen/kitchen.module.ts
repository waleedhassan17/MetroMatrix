import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FoodModule } from '../food/food.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { IngredientAlias } from './entities/ingredient-alias.entity';
import { KitchenIngredient } from './entities/kitchen-ingredient.entity';
import { StockBatch } from './entities/stock-batch.entity';
import { StockMovement } from './entities/stock-movement.entity';
import { RecipeCard } from './entities/recipe-card.entity';
import { RecipeLine } from './entities/recipe-line.entity';
import { KitchenAlert } from './entities/kitchen-alert.entity';
import { KitchenVendors } from './common/kitchen-vendors.service';
import { KitchenVoiceContexts } from './voice/kitchen-voice.contexts';
import { CustomerVoiceContexts } from './voice/customer-voice.contexts';
import { AnnounceController } from './voice/announce.controller';
import { KitchenAlertsService } from './stock/kitchen-alerts.service';
import { StockAvailabilityService } from './stock/stock-availability.service';
import { KitchenStockService } from './stock/kitchen-stock.service';
import { OrderStockService } from './stock/order-stock.service';
import { IngredientsService } from './stock/ingredients.service';
import { StockViewsService } from './stock/stock-views.service';
import { RecipesService } from './recipes/recipes.service';
import { KitchenStockController } from './stock/kitchen.controller';
import { KitchenJobsService } from './jobs/kitchen-jobs.service';
import { Supplier } from './entities/supplier.entity';
import { Purchase, PurchaseLine } from './entities/purchase.entity';
import { WasteEntry } from './entities/waste-entry.entity';
import {
  ReferenceItem,
  ReferencePrice,
} from './entities/reference-price.entity';
import { ItemCostSnapshot } from './entities/cost-snapshot.entity';
import { LineResolver } from './stock/line-resolver.service';
import { PurchasesService } from './purchases/purchases.service';
import { ReceiptScanService } from './purchases/receipt-scan.service';
import { CostingService } from './costing/costing.service';
import { PriceWatchService } from './costing/price-watch.service';
import { WasteService } from './waste/waste.service';
import { InsightCardsService } from './insights/insight-cards.service';
import { KitchenMoneyController } from './purchases/kitchen-money.controller';
import { AdminKitchenController } from './admin/admin-kitchen.controller';
import { MediaModule } from '../media/media.module';
import {
  DemandForecast,
  ForecastAccuracy,
} from './entities/demand-forecast.entity';
import { ForecastService } from './forecast/forecast.service';
import { PrepService } from './forecast/prep.service';
import { KitchenForecastController } from './forecast/forecast.controller';
import {
  SurplusBox,
  SurplusCustomerStatus,
  SurplusDonation,
  SurplusReservation,
} from './entities/surplus.entity';
import { PackingProof } from './entities/packing-proof.entity';
import { SurplusService } from './surplus/surplus.service';
import { PackingService } from './packing/packing.service';
import {
  CustomerSurplusController,
  KitchenSurplusController,
  RiderPackingController,
} from './surplus/surplus.controller';

/**
 * Kitchen intelligence for Food Court vendors (Chunk 5): voice on the
 * board, stock, recipes, costing, forecasting, waste, Bachat Box. Routes
 * are under /food/vendor/kitchen (staff: /admin/kitchen). Every query is
 * scoped by the vendor's branch or brand — anything else is 404.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      IngredientAlias,
      KitchenIngredient,
      StockBatch,
      StockMovement,
      RecipeCard,
      RecipeLine,
      KitchenAlert,
      Supplier,
      Purchase,
      PurchaseLine,
      WasteEntry,
      ReferenceItem,
      ReferencePrice,
      ItemCostSnapshot,
      DemandForecast,
      ForecastAccuracy,
      SurplusBox,
      SurplusReservation,
      SurplusDonation,
      SurplusCustomerStatus,
      PackingProof,
    ]),
    FoodModule,
    NotificationsModule,
    MediaModule,
  ],
  controllers: [
    AnnounceController,
    KitchenStockController,
    KitchenMoneyController,
    AdminKitchenController,
    KitchenForecastController,
    KitchenSurplusController,
    RiderPackingController,
    CustomerSurplusController,
  ],
  providers: [
    KitchenVendors,
    KitchenVoiceContexts,
    CustomerVoiceContexts,
    KitchenAlertsService,
    StockAvailabilityService,
    KitchenStockService,
    OrderStockService,
    IngredientsService,
    StockViewsService,
    RecipesService,
    KitchenJobsService,
    LineResolver,
    PurchasesService,
    ReceiptScanService,
    CostingService,
    PriceWatchService,
    WasteService,
    InsightCardsService,
    ForecastService,
    PrepService,
    SurplusService,
    PackingService,
  ],
  exports: [
    KitchenVendors,
    KitchenStockService,
    IngredientsService,
    StockAvailabilityService,
    KitchenAlertsService,
    LineResolver,
    CostingService,
    InsightCardsService,
    ForecastService,
    KitchenJobsService,
  ],
})
export class KitchenModule {}
