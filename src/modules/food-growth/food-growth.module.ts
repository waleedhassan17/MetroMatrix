import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FoodModule } from '../food/food.module';
import { KitchenModule } from '../kitchen/kitchen.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MediaModule } from '../media/media.module';
import {
  TiffinDelivery,
  TiffinPlan,
  TiffinSubscription,
} from './tiffin/entities/tiffin.entity';
import { TiffinService } from './tiffin/tiffin.service';
import {
  CustomerTiffinController,
  VendorTiffinController,
} from './tiffin/tiffin.controller';
import { GrowthJobsService } from './jobs/growth-jobs.service';
import {
  CateringQuote,
  CateringRequest,
} from './catering/entities/catering.entity';
import { CateringService } from './catering/catering.service';
import {
  CustomerCateringController,
  VendorCateringController,
} from './catering/catering.controller';
import { RamadanSettings } from './ramadan/entities/ramadan-settings.entity';
import { RamadanService } from './ramadan/ramadan.service';
import { VendorRamadanController } from './ramadan/ramadan.controller';
import { KitchenStory } from './story/entities/kitchen-story.entity';
import { StoryService } from './story/story.service';
import { VendorStoryController } from './story/story.controller';
import { StorefrontService } from './storefront/storefront.service';
import {
  PublicStorefrontController,
  VendorStorefrontController,
} from './storefront/storefront.controller';
import { GrowthDiscoveryService } from './discovery/growth-discovery.service';
import { AdminGrowthController } from './admin/admin-growth.controller';

/**
 * Food Court growth (Chunk 5, milestone 5B): tiffin subscriptions, catering,
 * Ramadan mode, the storefront and its attribution, kitchen stories, demand
 * data. Orders it creates go through Food's FoodOrderWriter and transitions,
 * so the board, riders and realtime see ordinary orders.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      TiffinPlan,
      TiffinSubscription,
      TiffinDelivery,
      CateringRequest,
      CateringQuote,
      RamadanSettings,
      KitchenStory,
    ]),
    FoodModule,
    KitchenModule,
    NotificationsModule,
    MediaModule,
  ],
  controllers: [
    VendorTiffinController,
    CustomerTiffinController,
    VendorCateringController,
    CustomerCateringController,
    VendorRamadanController,
    VendorStoryController,
    PublicStorefrontController,
    VendorStorefrontController,
    AdminGrowthController,
  ],
  providers: [
    TiffinService,
    GrowthJobsService,
    CateringService,
    RamadanService,
    StoryService,
    StorefrontService,
    GrowthDiscoveryService,
  ],
  exports: [
    TiffinService,
    GrowthJobsService,
    CateringService,
    RamadanService,
    StoryService,
  ],
})
export class FoodGrowthModule {}
