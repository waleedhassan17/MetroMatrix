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
    ]),
    MediaModule,
    BusinessesModule,
    AuthModule,
    PlansModule,
  ],
  controllers: [
    FoodReferenceController,
    VendorController,
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
  ],
  exports: [FoodVendorService],
})
export class FoodModule {}
