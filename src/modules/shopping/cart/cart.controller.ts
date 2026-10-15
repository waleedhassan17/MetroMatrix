import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { CartService } from './cart.service';
import { AddCartItemDto, UpdateCartItemDto } from './dto/cart.dto';
import { ShoppingCustomer } from '../common/shopping-customer.decorator';
import { CheckoutDto } from '../checkout/dto/checkout.dto';
import {
  CheckoutPlanner,
  planView,
} from '../checkout/checkout-planner.service';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';

const uuid = new ParseUUIDPipe();

@ApiTags('shop · customer')
@ShoppingCustomer()
@Controller('shop/cart')
export class CartController {
  constructor(
    private readonly cart: CartService,
    private readonly planner: CheckoutPlanner,
    private readonly dataSource: DataSource,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Cart grouped by store: live prices, subtotals, shipping preview, warnings (PRICE_CHANGED, OUT_OF_STOCK, LOW_STOCK, PRODUCT_UNAVAILABLE, STORE_UNAVAILABLE).',
  })
  view(@CurrentUser() me: AuthenticatedUser) {
    return this.cart.view(me.id);
  }

  @Post('items')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Add { variantId, quantity }. Same variant merges; quantity capped at stock (see `adjusted`).',
  })
  add(@CurrentUser() me: AuthenticatedUser, @Body() dto: AddCartItemDto) {
    return this.cart.addItem(me.id, dto);
  }

  @Patch('items/:id')
  @ApiOperation({ summary: 'Set quantity (also accepts a changed price).' })
  update(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.cart.updateItem(me.id, id, dto);
  }

  @Delete('items/:id')
  remove(@CurrentUser() me: AuthenticatedUser, @Param('id', uuid) id: string) {
    return this.cart.removeItem(me.id, id);
  }

  @Delete()
  clear(@CurrentUser() me: AuthenticatedUser) {
    return this.cart.clear(me.id);
  }

  @Post('preview')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Exact totals and per-store issues for a checkout body — same rules as checkout, nothing written.',
  })
  async preview(
    @CurrentUser() me: AuthenticatedUser,
    @Body() dto: CheckoutDto,
  ) {
    const plan = await this.planner.plan(this.dataSource.manager, me.id, dto);
    return planView(plan);
  }
}
