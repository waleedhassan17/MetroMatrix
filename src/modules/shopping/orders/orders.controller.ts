import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrderViewsService } from './order-views.service';
import { OrderActionsService } from './order-actions.service';
import {
  CustomerOrderQueryDto,
  PartnerOrderQueryDto,
  PaymentProofDto,
  ReasonDto,
  RefundDto,
  ShipOrderDto,
} from './dto/order.dto';
import { ShoppingCustomer } from '../common/shopping-customer.decorator';
import { ShoppingPartner } from '../common/shopping-partner.decorator';
import { CurrentStore, PartnerStore } from '../common/current-store.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';

const uuid = new ParseUUIDPipe();

@ApiTags('shop · customer')
@ShoppingCustomer()
@Controller('shop')
export class CustomerOrdersController {
  constructor(
    private readonly views: OrderViewsService,
    private readonly actions: OrderActionsService,
  ) {}

  @Get('orders')
  @ApiOperation({
    summary: 'Your order groups: ?status=active|completed|cancelled&page.',
  })
  list(
    @CurrentUser() me: AuthenticatedUser,
    @Query() q: CustomerOrderQueryDto,
  ) {
    return this.views.customerGroups(me.id, q);
  }

  @Get('orders/:groupCode')
  @ApiOperation({
    summary:
      'One order group: store orders, items, timeline, payment instructions.',
  })
  group(
    @CurrentUser() me: AuthenticatedUser,
    @Param('groupCode') code: string,
  ) {
    return this.views.customerGroup(me.id, code);
  }

  @Get('store-orders/:id')
  storeOrder(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', uuid) id: string,
  ) {
    return this.views.customerStoreOrder(me.id, id);
  }

  @Post('store-orders/:id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: '{ reason } — only before the store confirms.' })
  cancel(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.actions.customerCancel(me.id, id, dto.reason);
  }

  @Post('store-orders/:id/request-cancel')
  @HttpCode(200)
  @ApiOperation({
    summary: '{ reason } — confirmed/packed: asks the store, which decides.',
  })
  requestCancel(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.actions.requestCancel(me.id, id, dto.reason);
  }

  @Post('store-orders/:id/payment-proof')
  @HttpCode(200)
  @ApiOperation({
    summary: '{ paymentRef, proofUrl? } — transfer orders awaiting payment.',
  })
  proof(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body() dto: PaymentProofDto,
  ) {
    return this.actions.submitPaymentProof(me.id, id, dto);
  }

  @Post('store-orders/:id/received')
  @HttpCode(200)
  @ApiOperation({ summary: 'I received it (shipped → delivered).' })
  received(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', uuid) id: string,
  ) {
    return this.actions.received(me.id, id);
  }
}

@ApiTags('shop · partner')
@ShoppingPartner()
@Controller('shop/partner/orders')
export class PartnerOrdersController {
  constructor(
    private readonly views: OrderViewsService,
    private readonly actions: OrderActionsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Your store orders: ?status&paymentStatus&q&page.' })
  list(@CurrentStore() store: PartnerStore, @Query() q: PartnerOrderQueryDto) {
    return this.views.partnerList(store.id, q);
  }

  @Get(':id')
  get(@CurrentStore() store: PartnerStore, @Param('id', uuid) id: string) {
    return this.views.partnerOrder(store.id, id);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  confirm(@CurrentStore() s: PartnerStore, @Param('id', uuid) id: string) {
    return this.actions.confirm(s.id, s.ownerUserId, id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @ApiOperation({ summary: '{ reason } — decline a new (placed) order.' })
  reject(
    @CurrentStore() s: PartnerStore,
    @Param('id', uuid) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.actions.reject(s.id, s.ownerUserId, id, dto.reason);
  }

  @Post(':id/pack')
  @HttpCode(200)
  pack(@CurrentStore() s: PartnerStore, @Param('id', uuid) id: string) {
    return this.actions.pack(s.id, s.ownerUserId, id);
  }

  @Post(':id/ship')
  @HttpCode(200)
  @ApiOperation({
    summary:
      '{ courierName, trackingRef } or { courierName: "self", riderName, riderPhone }. Transfer orders must be paid first.',
  })
  ship(
    @CurrentStore() s: PartnerStore,
    @Param('id', uuid) id: string,
    @Body() dto: ShipOrderDto,
  ) {
    return this.actions.ship(s.id, s.ownerUserId, id, dto);
  }

  @Post(':id/deliver')
  @HttpCode(200)
  deliver(@CurrentStore() s: PartnerStore, @Param('id', uuid) id: string) {
    return this.actions.deliver(s.id, s.ownerUserId, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({
    summary:
      '{ reason } — placed, confirmed or packed. Restocks and releases the coupon.',
  })
  cancel(
    @CurrentStore() s: PartnerStore,
    @Param('id', uuid) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.actions.storeCancel(s.id, s.ownerUserId, id, dto.reason);
  }

  @Post(':id/payment/confirm')
  @HttpCode(200)
  confirmPayment(
    @CurrentStore() s: PartnerStore,
    @Param('id', uuid) id: string,
  ) {
    return this.actions.confirmPayment(s.id, s.ownerUserId, id);
  }

  @Post(':id/payment/reject')
  @HttpCode(200)
  @ApiOperation({
    summary:
      '{ reason } — transfer not received; the customer gets ≥ 12 h to resubmit.',
  })
  rejectPayment(
    @CurrentStore() s: PartnerStore,
    @Param('id', uuid) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.actions.rejectPayment(s.id, s.ownerUserId, id, dto.reason);
  }

  @Post(':id/cash-collected')
  @HttpCode(200)
  cashCollected(
    @CurrentStore() s: PartnerStore,
    @Param('id', uuid) id: string,
  ) {
    return this.actions.cashCollected(s.id, s.ownerUserId, id);
  }

  @Post(':id/refund')
  @HttpCode(200)
  @ApiOperation({
    summary:
      '{ amount, refundRef } — record a refund sent off-platform (refund_due → refunded).',
  })
  refund(
    @CurrentStore() s: PartnerStore,
    @Param('id', uuid) id: string,
    @Body() dto: RefundDto,
  ) {
    return this.actions.refund(s.id, s.ownerUserId, id, dto);
  }
}
