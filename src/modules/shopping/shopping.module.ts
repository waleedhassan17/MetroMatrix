import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BusinessesModule } from '../businesses/businesses.module';
import { MediaModule } from '../media/media.module';
import { ShopCategory } from './catalog/entities/shop-category.entity';
import { Store } from './stores/entities/store.entity';
import { StorePaymentAccount } from './stores/entities/store-payment-account.entity';
import { StoreCollection } from './stores/entities/store-collection.entity';
import { ShopBanner } from './catalog/entities/shop-banner.entity';
import { Product } from './products/entities/product.entity';
import { ProductImage } from './products/entities/product-image.entity';
import { ProductVariant } from './products/entities/product-variant.entity';
import { InventoryMovement } from './inventory/entities/inventory-movement.entity';
import { StoresService } from './stores/stores.service';
import { PartnerStoreController } from './stores/stores.controller';
import { PartnerStoreGuard } from './common/partner-store.guard';
import { ProductsService } from './products/products.service';
import { PartnerProductsController } from './products/products.controller';
import { InventoryService } from './inventory/inventory.service';
import { PartnerInventoryController } from './inventory/inventory.controller';
import { CatalogService } from './catalog/catalog.service';
import { CatalogController } from './catalog/catalog.controller';
import { Cart } from './cart/entities/cart.entity';
import { CartItem } from './cart/entities/cart-item.entity';
import { WishlistItem } from './wishlist/entities/wishlist-item.entity';
import { Coupon } from './coupons/entities/coupon.entity';
import { CouponRedemption } from './coupons/entities/coupon-redemption.entity';
import { CartService } from './cart/cart.service';
import { CartController } from './cart/cart.controller';
import { WishlistService } from './wishlist/wishlist.service';
import { WishlistController } from './wishlist/wishlist.controller';
import { CouponsService } from './coupons/coupons.service';
import {
  PartnerCouponsController,
  StoreCouponsController,
} from './coupons/coupons.controller';
import { CheckoutPlanner } from './checkout/checkout-planner.service';
import { AuthModule } from '../auth/auth.module';

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
      ShopBanner,
      Product,
      ProductImage,
      ProductVariant,
      InventoryMovement,
      Cart,
      CartItem,
      WishlistItem,
      Coupon,
      CouponRedemption,
    ]),
    AuthModule,
    BusinessesModule,
    MediaModule,
  ],
  controllers: [
    CatalogController,
    PartnerStoreController,
    PartnerProductsController,
    PartnerInventoryController,
    PartnerCouponsController,
    StoreCouponsController,
    CartController,
    WishlistController,
  ],
  providers: [
    StoresService,
    PartnerStoreGuard,
    ProductsService,
    InventoryService,
    CatalogService,
    CartService,
    WishlistService,
    CouponsService,
    CheckoutPlanner,
  ],
  exports: [StoresService, InventoryService],
})
export class ShoppingModule {}
