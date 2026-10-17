import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { FoodOrderViewsService } from './food-order-views.service';
import { FoodOrderActionsService } from './food-order-actions.service';
import { CustomerFoodOrdersQueryDto } from './dto/order-query.dto';
import { FoodPaymentProofDto, OptionalReasonDto } from './dto/order-action.dto';
import { FoodCartService } from '../cart/food-cart.service';
import { FoodCustomer } from '../common/food-roles.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';

@ApiTags('food · customer')
@FoodCustomer()
@Controller('food/orders')
export class CustomerFoodOrdersController {
  constructor(
    private readonly views: FoodOrderViewsService,
    private readonly actions: FoodOrderActionsService,
    private readonly cart: FoodCartService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Your food orders (?status=active|past).' })
  list(
    @CurrentUser() me: AuthenticatedUser,
    @Query() q: CustomerFoodOrdersQueryDto,
  ) {
    return this.views.customerList(me.id, q);
  }

  @Get(':code')
  @ApiOperation({
    summary:
      'Order detail: lines, money, payment instructions, events, canCancel / canReview / canReorder.',
  })
  get(@CurrentUser() me: AuthenticatedUser, @Param('code') code: string) {
    return this.views.customer(me.id, code);
  }

  @Get(':code/tracking')
  @ApiOperation({
    summary:
      'Status, ETA, the branch and drop points, and the rider (name, phone, vehicle, last location).',
  })
  tracking(@CurrentUser() me: AuthenticatedUser, @Param('code') code: string) {
    return this.views.tracking(me.id, code);
  }

  @Post(':code/cancel')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Only while placed (before the restaurant accepts).',
  })
  cancel(
    @CurrentUser() me: AuthenticatedUser,
    @Param('code') code: string,
    @Body() dto: OptionalReasonDto,
  ) {
    return this.actions.customerCancel(me.id, code, dto.reason);
  }

  @Post(':code/payment-proof')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Transfer orders: your reference (and screenshot) for the vendor to confirm.',
  })
  paymentProof(
    @CurrentUser() me: AuthenticatedUser,
    @Param('code') code: string,
    @Body() dto: FoodPaymentProofDto,
  ) {
    return this.actions.paymentProof(me.id, code, dto);
  }

  @Post(':code/reorder')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Rebuild your cart from this order at today’s menu and prices; lines that can’t be ordered are reported in `dropped`.',
  })
  reorder(@CurrentUser() me: AuthenticatedUser, @Param('code') code: string) {
    return this.cart.reorder(me.id, code);
  }
}
