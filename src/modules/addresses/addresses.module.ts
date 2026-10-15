import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Address } from './entities/address.entity';
import { AddressesService } from './addresses.service';
import { AddressesController } from './addresses.controller';
import { AuthModule } from '../auth/auth.module';

/** Core module: saved delivery addresses, reused by Shopping, Food, Healthcare. */
@Module({
  imports: [TypeOrmModule.forFeature([Address]), AuthModule],
  controllers: [AddressesController],
  providers: [AddressesService],
  exports: [AddressesService],
})
export class AddressesModule {}
