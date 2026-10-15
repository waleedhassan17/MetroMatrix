import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { CouponsService } from './coupons.service';
import {
  CouponQueryDto,
  CreateCouponDto,
  UpdateCouponDto,
} from './dto/coupon.dto';
import { ShoppingPartner } from '../common/shopping-partner.decorator';
import { ShoppingCustomer } from '../common/shopping-customer.decorator';
import { CurrentStore, PartnerStore } from '../common/current-store.decorator';
import { CartService } from '../cart/cart.service';
import { VISIBLE_STORE_SQL } from '../common/catalog-sql';
import { ErrorCode } from '../../../common/errors/codes';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';

const uuid = new ParseUUIDPipe();

@ApiTags('shop · partner')
@ShoppingPartner()
@Controller('shop/partner/coupons')
export class PartnerCouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Your coupons: ?state=active|scheduled|expired|exhausted|inactive.',
  })
  list(@CurrentStore() store: PartnerStore, @Query() q: CouponQueryDto) {
    return this.coupons.list(store.id, q);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a coupon. Codes are upper-case and unique per store.',
  })
  create(@CurrentStore() store: PartnerStore, @Body() dto: CreateCouponDto) {
    return this.coupons.create(store.id, dto);
  }

  @Get(':id')
  get(@CurrentStore() store: PartnerStore, @Param('id', uuid) id: string) {
    return this.coupons.get(store.id, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Edit terms; type and value lock once the coupon is used.',
  })
  update(
    @CurrentStore() store: PartnerStore,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateCouponDto,
  ) {
    return this.coupons.update(store.id, id, dto);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  deactivate(
    @CurrentStore() store: PartnerStore,
    @Param('id', uuid) id: string,
  ) {
    return this.coupons.deactivate(store.id, id);
  }
}

@ApiTags('shop · customer')
@ShoppingCustomer()
@Controller('shop/stores')
export class StoreCouponsController {
  constructor(
    private readonly coupons: CouponsService,
    private readonly cart: CartService,
    private readonly dataSource: DataSource,
  ) {}

  @Get(':id/coupons/available')
  @ApiOperation({
    summary:
      "Coupons you can use at this store now, with each one's saving on your cart.",
  })
  async available(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', uuid) storeId: string,
  ) {
    const [open] = await this.dataSource.query(
      `SELECT 1 FROM stores s JOIN businesses b ON b.id = s.business_id WHERE s.id = $1 AND ${VISIBLE_STORE_SQL}`,
      [storeId],
    );
    if (!open) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Store not found.',
      });
    }
    const subtotal = await this.cart.storeSubtotal(me.id, storeId);
    return {
      storeSubtotal: subtotal,
      items: await this.coupons.available(storeId, me.id, subtotal),
    };
  }
}
