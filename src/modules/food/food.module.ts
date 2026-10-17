import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BusinessesModule } from '../businesses/businesses.module';
import { AuthModule } from '../auth/auth.module';
import { PlansModule } from '../plans/plans.module';
import { FoodBrand } from './vendor/entities/food-brand.entity';
import { Branch } from './vendor/entities/branch.entity';
import { Rider } from './riders/entities/rider.entity';
import { FoodVendorService } from './vendor/food-vendor.service';
import { VendorGuard } from './common/vendor.guard';
import { RiderGuard } from './common/rider.guard';
import { RidersService } from './riders/riders.service';
import {
  RiderSelfController,
  VendorRidersController,
} from './riders/riders.controller';
import { VendorPlanController } from './plans/vendor-plan.controller';
import { AdminFoodPlanController } from './admin/admin-food-plan.controller';
import { AdminFoodSafetyController } from './admin/admin-food-safety.controller';
import { Cuisine } from './reference/entities/cuisine.entity';
import { BranchHours } from './vendor/entities/branch-hours.entity';
import { BranchClosure } from './vendor/entities/branch-closure.entity';
import { DeliveryFeeBand } from './vendor/entities/delivery-fee-band.entity';
import { VendorPaymentAccount } from './vendor/entities/vendor-payment-account.entity';
import { BranchStateService } from './availability/branch-state.service';
import { ServiceabilityService } from './availability/serviceability.service';
import { VendorSettingsService } from './vendor/vendor-settings.service';
import { VendorSetupService } from './vendor/vendor-setup.service';
import { VendorController } from './vendor/vendor.controller';
import { FoodReferenceController } from './reference/reference.controller';
import { MediaModule } from '../media/media.module';
import { MenuCategory } from './menu/entities/menu-category.entity';
import { MenuItem } from './menu/entities/menu-item.entity';
import { ItemVariant } from './menu/entities/item-variant.entity';
import { OptionGroup } from './menu/entities/option-group.entity';
import { MenuOption } from './menu/entities/menu-option.entity';
import { ItemOptionGroup } from './menu/entities/item-option-group.entity';
import { BranchItemOverride } from './menu/entities/branch-item-override.entity';
import { BranchOptionOverride } from './menu/entities/branch-option-override.entity';
import { PreorderSlot } from './menu/entities/preorder-slot.entity';
import { MenuService } from './menu/menu.service';
import { MenuAvailabilityService } from './menu/menu-availability.service';
import { MenuReadService } from './menu/menu-read.service';
import { VendorMenuController } from './menu/menu.controller';
import { FoodDiscoveryService } from './discovery/discovery.service';
import { FoodDiscoveryController } from './discovery/discovery.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { FoodCart } from './cart/entities/food-cart.entity';
import { FoodCartItem } from './cart/entities/food-cart-item.entity';
import { FoodPromotion } from './promotions/entities/food-promotion.entity';
import { FoodOrder } from './orders/entities/food-order.entity';
import { FoodOrderItem } from './orders/entities/food-order-item.entity';
import { FoodOrderEvent } from './orders/entities/food-order-event.entity';
import { PromotionsService } from './promotions/promotions.service';
import { VendorPromotionsController } from './promotions/promotions.controller';
import { FoodScheduleService } from './checkout/food-schedule.service';
import { FoodCheckoutPlanner } from './checkout/food-checkout-planner.service';
import {
  FOOD_CHECKOUT_FAULT_INJECTOR,
  FoodCheckoutService,
  noFoodCheckoutFaults,
} from './checkout/food-checkout.service';
import {
  FoodCheckoutController,
  FoodSlotsController,
} from './checkout/checkout.controller';
import { FoodCartService } from './cart/food-cart.service';
import { FoodCartController } from './cart/cart.controller';
import { FoodOrderTransitionsService } from './orders/food-order-transitions.service';
import { FoodOrderViewsService } from './orders/food-order-views.service';
import { FoodNotifier } from './orders/food-notifier.service';
import { CustomerFoodOrdersController } from './orders/customer-orders.controller';
import { FoodJobsService } from './jobs/food-jobs.service';
import { FoodOrderActionsService } from './orders/food-order-actions.service';
import { VendorFoodOrdersController } from './orders/vendor-orders.controller';
import { FoodFavourite } from './favourites/entities/food-favourite.entity';
import { FoodFavouritesService } from './favourites/favourites.service';
import { FoodFavouritesController } from './favourites/favourites.controller';
import { FoodGateway } from './realtime/food.gateway';
import { RiderLocationLog } from './riders/entities/rider-location-log.entity';
import { RiderCashEntry } from './riders/entities/rider-cash-entry.entity';
import { RiderLocationService } from './riders/rider-location.service';
import { RiderDeliveryService } from './riders/rider-delivery.service';
import { RiderDeliveryController } from './riders/rider-delivery.controller';
import { AdminModule } from '../admin/admin.module';
import { FoodReview } from './reviews/entities/food-review.entity';
import { FoodBanner } from './admin/entities/food-banner.entity';
import { FoodAggregatesService } from './reviews/food-aggregates.service';
import { FoodReviewsService } from './reviews/food-reviews.service';
import {
  CustomerFoodReviewsController,
  PublicFoodReviewsController,
  VendorFoodReviewsController,
} from './reviews/reviews.controller';
import { FoodInsightsService } from './insights/insights.service';
import { VendorInsightsController } from './insights/insights.controller';
import { FoodBannersService } from './admin/food-banners.service';
import { AdminFoodService } from './admin/admin-food.service';
import { AdminFoodController } from './admin/admin-food.controller';

/**
 * MetroMatrix Food Court. Sub-domains live in their own folders (reference,
 * vendor, menu, availability, discovery, cart, promotions, checkout, orders,
 * riders, realtime, reviews, insights, plans, admin, jobs); this module wires
 * them. Routes are under /api/v1/food (vendor /food/vendor, rider /food/rider,
 * staff /admin/food).
 *
 * Zero commission: vendors take payment directly and deliver themselves.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      FoodBrand,
      Branch,
      Rider,
      Cuisine,
      BranchHours,
      BranchClosure,
      DeliveryFeeBand,
      VendorPaymentAccount,
      MenuCategory,
      MenuItem,
      ItemVariant,
      OptionGroup,
      MenuOption,
      ItemOptionGroup,
      BranchItemOverride,
      BranchOptionOverride,
      PreorderSlot,
      FoodCart,
      FoodCartItem,
      FoodPromotion,
      FoodOrder,
      FoodOrderItem,
      FoodOrderEvent,
      FoodFavourite,
      RiderLocationLog,
      RiderCashEntry,
      FoodReview,
      FoodBanner,
    ]),
    MediaModule,
    BusinessesModule,
    AuthModule,
    PlansModule,
    NotificationsModule,
    AdminModule,
  ],
  controllers: [
    FoodReferenceController,
    FoodDiscoveryController,
    FoodSlotsController,
    FoodCartController,
    FoodCheckoutController,
    CustomerFoodOrdersController,
    VendorFoodOrdersController,
    FoodFavouritesController,
    VendorPromotionsController,
    VendorController,
    VendorMenuController,
    VendorRidersController,
    RiderSelfController,
    RiderDeliveryController,
    CustomerFoodReviewsController,
    PublicFoodReviewsController,
    VendorFoodReviewsController,
    VendorInsightsController,
    AdminFoodController,
    VendorPlanController,
    AdminFoodPlanController,
    AdminFoodSafetyController,
  ],
  providers: [
    FoodVendorService,
    VendorGuard,
    RiderGuard,
    RidersService,
    BranchStateService,
    ServiceabilityService,
    VendorSettingsService,
    VendorSetupService,
    MenuService,
    MenuAvailabilityService,
    MenuReadService,
    FoodDiscoveryService,
    PromotionsService,
    FoodScheduleService,
    FoodCheckoutPlanner,
    FoodCartService,
    FoodCheckoutService,
    { provide: FOOD_CHECKOUT_FAULT_INJECTOR, useValue: noFoodCheckoutFaults },
    FoodOrderTransitionsService,
    FoodOrderViewsService,
    FoodNotifier,
    FoodJobsService,
    FoodOrderActionsService,
    FoodFavouritesService,
    FoodGateway,
    RiderLocationService,
    RiderDeliveryService,
    FoodAggregatesService,
    FoodReviewsService,
    FoodInsightsService,
    FoodBannersService,
    AdminFoodService,
  ],
  exports: [FoodVendorService],
})
export class FoodModule {}
