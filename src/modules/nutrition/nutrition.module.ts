import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FoodModule } from '../food/food.module';
import { KitchenModule } from '../kitchen/kitchen.module';
import { NutritionFood } from './entities/nutrition-food.entity';
import { MenuItemNutrition } from './entities/menu-item-nutrition.entity';
import { NutritionProfile } from './entities/nutrition-profile.entity';
import { ItemNutritionService } from './item-nutrition.service';
import { NutritionMappingService } from './nutrition-mapping.service';
import { NutritionProfileService } from './nutrition-profile.service';
import { NutritionDiscoveryService } from './nutrition-discovery.service';
import {
  CustomerNutritionController,
  VendorNutritionController,
} from './nutrition.controller';

/**
 * Nutrition (Chunk 5, P10): USDA reference foods, ingredient mapping,
 * per-dish nutrition (recipe or a labelled AI estimate), badges and filters,
 * and the customer's opt-in profile and ordered-food summary.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      NutritionFood,
      MenuItemNutrition,
      NutritionProfile,
    ]),
    FoodModule,
    KitchenModule,
  ],
  controllers: [VendorNutritionController, CustomerNutritionController],
  providers: [
    ItemNutritionService,
    NutritionMappingService,
    NutritionProfileService,
    NutritionDiscoveryService,
  ],
  exports: [ItemNutritionService, NutritionMappingService],
})
export class NutritionModule {}
