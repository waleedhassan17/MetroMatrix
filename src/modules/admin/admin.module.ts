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

@Module({
  imports: [TypeOrmModule.forFeature([User]), AuthModule, BusinessesModule],
  controllers: [
    AdminBusinessesController,
    AdminUsersController,
    AdminTotpController,
  ],
  providers: [AdminService, AdminTotpService],
  exports: [AdminService],
})
export class AdminModule {}
