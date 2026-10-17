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
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { FoodCartService } from './food-cart.service';
import {
  AddCartItemDto,
  AddCartItemQueryDto,
  PatchCartDto,
  UpdateCartItemDto,
} from './dto/cart.dto';
import { FoodPreviewDto } from '../checkout/dto/checkout.dto';
import { FoodCustomer } from '../common/food-roles.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';

@ApiTags('food · customer')
@FoodCustomer()
@Controller('food/cart')
export class FoodCartController {
  constructor(private readonly cart: FoodCartService) {}

  @Get()
  @ApiOperation({
    summary:
      'The cart, re-priced now, with warnings (unavailable, price changed, closed, below minimum).',
  })
  get(@CurrentUser() me: AuthenticatedUser) {
    return this.cart.view(me.id);
  }

  @Delete()
  clear(@CurrentUser() me: AuthenticatedUser) {
    return this.cart.clear(me.id);
  }

  @Patch()
  @ApiOperation({
    summary: 'Fulfilment (delivery | pickup) and scheduledFor (null = ASAP).',
  })
  patch(@CurrentUser() me: AuthenticatedUser, @Body() dto: PatchCartDto) {
    return this.cart.patch(me.id, dto);
  }

  @Post('items')
  @ApiOperation({
    summary:
      'Add a dish. Another vendor in the cart → 409 CART_OTHER_VENDOR (?replace=true starts a new cart). Option problems name the item and group.',
  })
  add(
    @CurrentUser() me: AuthenticatedUser,
    @Body() dto: AddCartItemDto,
    @Query() q: AddCartItemQueryDto,
  ) {
    return this.cart.addItem(me.id, dto, q.replace === 'true');
  }

  @Patch('items/:id')
  updateItem(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.cart.updateItem(me.id, id, dto);
  }

  @Delete('items/:id')
  removeItem(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.cart.removeItem(me.id, id);
  }

  @Post('preview')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Totals exactly as checkout would charge them: lines, deal, delivery fee (the only fee), ETA, payment options, and every issue.',
  })
  preview(@CurrentUser() me: AuthenticatedUser, @Body() dto: FoodPreviewDto) {
    return this.cart.preview(me.id, dto);
  }
}
