import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { WishlistService } from './wishlist.service';
import { ShoppingCustomer } from '../common/shopping-customer.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../../common/pagination/pagination';

const uuid = new ParseUUIDPipe();

@ApiTags('shop · customer')
@ShoppingCustomer()
@Controller('shop/wishlist')
export class WishlistController {
  constructor(private readonly wishlist: WishlistService) {}

  @Get()
  @ApiOperation({
    summary: 'Saved products, newest first (unavailable ones flagged).',
  })
  list(@CurrentUser() me: AuthenticatedUser, @Query() q: PaginationQueryDto) {
    return this.wishlist.list(me.id, q);
  }

  @Post(':productId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Save a product (idempotent).' })
  add(
    @CurrentUser() me: AuthenticatedUser,
    @Param('productId', uuid) productId: string,
  ) {
    return this.wishlist.add(me.id, productId);
  }

  @Delete(':productId')
  @ApiOperation({ summary: 'Unsave a product (idempotent).' })
  remove(
    @CurrentUser() me: AuthenticatedUser,
    @Param('productId', uuid) productId: string,
  ) {
    return this.wishlist.remove(me.id, productId);
  }
}
