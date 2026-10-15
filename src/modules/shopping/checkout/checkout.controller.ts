import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CheckoutService } from './checkout.service';
import { CheckoutDto } from './dto/checkout.dto';
import { ShoppingCustomer } from '../common/shopping-customer.decorator';
import { RequireIdempotencyKey } from '../../../common/decorators/require-idempotency-key.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';

@ApiTags('shop · customer')
@ShoppingCustomer()
@Controller('shop/checkout')
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

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
      'Place the order: one store order per store in the cart, all in one transaction. Returns the order group.',
  })
  place(@CurrentUser() me: AuthenticatedUser, @Body() dto: CheckoutDto) {
    return this.checkout.checkout(me.id, dto);
  }
}
