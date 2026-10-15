import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from './entities/notification.entity';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { ExpoPushClient } from './expo-push.client';
import { UserDevice } from '../users/entities/user-device.entity';
import { AuthModule } from '../auth/auth.module';

/** Core module: in-app notifications + Expo push, reused by every service. */
@Module({
  imports: [TypeOrmModule.forFeature([Notification, UserDevice]), AuthModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, ExpoPushClient],
  exports: [NotificationsService],
})
export class NotificationsModule {}
