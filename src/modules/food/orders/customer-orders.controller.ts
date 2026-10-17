import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { FoodOrderViewsService } from './food-order-views.service';
import { CustomerFoodOrdersQueryDto } from './dto/order-query.dto';
import { FoodCustomer } from '../common/food-roles.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';

@ApiTags('food · customer')
@FoodCustomer()
@Controller('food/orders')
export class CustomerFoodOrdersController {
  constructor(private readonly views: FoodOrderViewsService) {}

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
}
