import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Business } from './entities/business.entity';
import { BusinessDocument } from './entities/business-document.entity';
import { BusinessesController } from './businesses.controller';
import { BusinessesService } from './businesses.service';
import { MediaModule } from '../media/media.module';
import { AuthModule } from '../auth/auth.module';
import { BusinessApprovedGuard } from '../../common/guards/business-approved.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([Business, BusinessDocument]),
    MediaModule,
    AuthModule,
  ],
  controllers: [BusinessesController],
  providers: [BusinessesService, BusinessApprovedGuard],
  exports: [BusinessesService, BusinessApprovedGuard, TypeOrmModule],
})
export class BusinessesModule {}
