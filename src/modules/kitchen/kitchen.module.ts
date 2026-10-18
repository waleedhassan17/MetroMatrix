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
    ]),
    FoodModule,
    NotificationsModule,
  ],
  controllers: [AnnounceController, KitchenStockController],
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
  ],
  exports: [
    KitchenVendors,
    KitchenStockService,
    IngredientsService,
    StockAvailabilityService,
    KitchenAlertsService,
  ],
})
export class KitchenModule {}
