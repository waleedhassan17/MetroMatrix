import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BusinessesModule } from '../businesses/businesses.module';
import { MediaModule } from '../media/media.module';
import { ShopCategory } from './catalog/entities/shop-category.entity';
import { Store } from './stores/entities/store.entity';
import { StorePaymentAccount } from './stores/entities/store-payment-account.entity';
import { StoreCollection } from './stores/entities/store-collection.entity';
import { StoresService } from './stores/stores.service';
import { PartnerStoreController } from './stores/stores.controller';
import { PartnerStoreGuard } from './common/partner-store.guard';

/**
 * MetroMatrix Shopping. Sub-domains live in their own folders (catalog,
 * stores, products, inventory, cart, wishlist, checkout, orders, returns,
 * reviews, coupons, admin), each with controller / service / dto / entities;
 * this module wires them together.
 *
 * No money is ever held: customers pay each store directly (COD or transfer
 * to the store's own account). There is no wallet, payout or commission here.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ShopCategory,
      Store,
      StorePaymentAccount,
      StoreCollection,
    ]),
    BusinessesModule,
    MediaModule,
  ],
  controllers: [PartnerStoreController],
  providers: [StoresService, PartnerStoreGuard],
  exports: [StoresService],
})
export class ShoppingModule {}
