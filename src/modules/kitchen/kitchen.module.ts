import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FoodModule } from '../food/food.module';
import { IngredientAlias } from './entities/ingredient-alias.entity';
import { KitchenVendors } from './common/kitchen-vendors.service';
import { KitchenVoiceContexts } from './voice/kitchen-voice.contexts';
import { CustomerVoiceContexts } from './voice/customer-voice.contexts';
import { AnnounceController } from './voice/announce.controller';

/**
 * Kitchen intelligence for Food Court vendors (Chunk 5): voice on the
 * board, stock, recipes, costing, forecasting, waste, Bachat Box. Routes
 * are under /food/vendor/kitchen (staff: /admin/kitchen). Every query is
 * scoped by the vendor's branch or brand — anything else is 404.
 */
@Module({
  imports: [TypeOrmModule.forFeature([IngredientAlias]), FoodModule],
  controllers: [AnnounceController],
  providers: [KitchenVendors, KitchenVoiceContexts, CustomerVoiceContexts],
  exports: [KitchenVendors],
})
export class KitchenModule {}
