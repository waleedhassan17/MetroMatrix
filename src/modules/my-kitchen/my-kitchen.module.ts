import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsModule } from '../notifications/notifications.module';
import { PantryItem } from './entities/pantry-item.entity';
import { PantryService } from './pantry.service';
import { MyKitchenRecipesService } from './my-kitchen-recipes.service';
import { MyKitchenVoiceContexts } from './my-kitchen-voice.contexts';
import { MyKitchenJobsService } from './my-kitchen-jobs.service';
import { MyKitchenController } from './my-kitchen.controller';

/**
 * My Kitchen (Chunk 5, P11): the customer's pantry with expiry reminders,
 * recipe ideas that use what expires first, the grocery compare
 * (missing-to-bag) on Shopping's grocery products, pantry drafts from
 * delivered grocery orders, and the pantry voice screen.
 */
@Module({
  imports: [TypeOrmModule.forFeature([PantryItem]), NotificationsModule],
  controllers: [MyKitchenController],
  providers: [
    PantryService,
    MyKitchenRecipesService,
    MyKitchenVoiceContexts,
    MyKitchenJobsService,
  ],
  exports: [PantryService, MyKitchenJobsService],
})
export class MyKitchenModule {}
