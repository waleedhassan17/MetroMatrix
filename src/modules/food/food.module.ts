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
    ]),
    MediaModule,
    BusinessesModule,
    AuthModule,
    PlansModule,
  ],
  controllers: [
    FoodReferenceController,
    FoodDiscoveryController,
    VendorController,
    VendorMenuController,
    VendorRidersController,
    RiderSelfController,
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
  ],
  exports: [FoodVendorService],
})
export class FoodModule {}
