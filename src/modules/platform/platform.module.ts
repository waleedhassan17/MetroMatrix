import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformSetting } from './entities/platform-setting.entity';
import { PlatformSettingsService } from './platform-settings.service';
import {
  AdminSettingsController,
  PublicConfigController,
} from './platform.controller';
import { PlatformGuard } from './platform.guard';
import { AuthModule } from '../auth/auth.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [TypeOrmModule.forFeature([PlatformSetting]), AuthModule, AiModule],
  controllers: [AdminSettingsController, PublicConfigController],
  providers: [PlatformSettingsService, PlatformGuard],
  exports: [PlatformSettingsService, PlatformGuard],
})
export class PlatformModule {}
