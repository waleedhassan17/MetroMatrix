import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { FoodCheckoutService } from './food-checkout.service';
import { FoodScheduleService } from './food-schedule.service';
import { FoodCheckoutDto } from './dto/checkout.dto';
import { FoodCustomer } from '../common/food-roles.decorator';
import { RequireIdempotencyKey } from '../../../common/decorators/require-idempotency-key.decorator';
import { OptionalAuth } from '../../../common/decorators/optional-auth.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';

@ApiTags('food · customer')
@FoodCustomer()
@Controller('food/checkout')
export class FoodCheckoutController {
  constructor(private readonly checkout: FoodCheckoutService) {}

  @Post()
  @HttpCode(201)
  @RequireIdempotencyKey()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'A fresh UUID per checkout attempt; a retry with the same key replays the first response.',
  })
  @ApiOperation({
    summary:
      'Place the order in one transaction (portions, slot and promotion taken atomically). Returns the order.',
  })
  place(@CurrentUser() me: AuthenticatedUser, @Body() dto: FoodCheckoutDto) {
    return this.checkout.checkout(me.id, dto);
  }
}

@ApiTags('food · discovery')
@OptionalAuth()
@Throttle({ default: { limit: 600, ttl: 60_000 } })
@Controller('food/vendors')
export class FoodSlotsController {
  constructor(private readonly schedule: FoodScheduleService) {}

  @Get(':id/slots')
  @ApiOperation({
    summary:
      'Pre-order slots for the next 7 days with places left (home kitchens). Vendor id or slug.',
  })
  slots(@Param('id') id: string) {
    return this.schedule.slotsFor(id);
  }
}
