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

/**
 * Food Court growth (Chunk 5, milestone 5B): tiffin subscriptions, catering,
 * Ramadan mode, the storefront and its attribution, kitchen stories, demand
 * data. Orders it creates go through Food's FoodOrderWriter and transitions,
 * so the board, riders and realtime see ordinary orders.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([TiffinPlan, TiffinSubscription, TiffinDelivery]),
    FoodModule,
    KitchenModule,
    NotificationsModule,
    MediaModule,
  ],
  controllers: [VendorTiffinController, CustomerTiffinController],
  providers: [TiffinService, GrowthJobsService],
  exports: [TiffinService, GrowthJobsService],
})
export class FoodGrowthModule {}
