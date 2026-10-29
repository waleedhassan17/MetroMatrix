import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { BusinessesModule } from '../businesses/businesses.module';
import { User } from '../users/entities/user.entity';
import { AdminService } from './admin.service';
import { AdminTotpService } from './admin-totp.service';
import {
  AdminBusinessesController,
  AdminTotpController,
  AdminUsersController,
} from './admin.controller';
import { AdminAdminsController } from './admins/admin-admins.controller';
import { AdminAdminsService } from './admins/admin-admins.service';
import { AdminMetaController } from './admin-meta.controller';
import { AdminMetaService } from './admin-meta.service';
import { AdminAnalyticsController } from './analytics/admin-analytics.controller';
import { AdminAnalyticsService } from './analytics/admin-analytics.service';
import { AdminAuditController } from './audit/admin-audit.controller';
import { AdminAuditService } from './audit/admin-audit.service';
import { OperationalAuditEvent } from '../../common/audit/operational-audit-event.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, OperationalAuditEvent]),
    AuthModule,
    BusinessesModule,
    NotificationsModule,
    AiModule,
  ],
  controllers: [
    AdminBusinessesController,
    AdminUsersController,
    AdminTotpController,
    AdminAdminsController,
    AdminMetaController,
    AdminAnalyticsController,
    AdminAuditController,
  ],
  providers: [
    AdminService,
    AdminTotpService,
    AdminAdminsService,
    AdminMetaService,
    AdminAnalyticsService,
    AdminAuditService,
  ],
  exports: [AdminService],
})
export class AdminModule {}
