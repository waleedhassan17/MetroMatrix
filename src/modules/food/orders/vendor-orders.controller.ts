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
import { FoodOrderActionsService } from './food-order-actions.service';
import { FoodOrderViewsService } from './food-order-views.service';
import {
  AcceptOrderDto,
  DeliveredDto,
  ReasonDto,
  VendorOrdersQueryDto,
} from './dto/order-action.dto';
import { FoodVendor } from '../common/food-roles.decorator';
import { RiderDeliveryService } from '../riders/rider-delivery.service';
import { AssignRiderDto } from '../riders/dto/delivery.dto';
import { CurrentVendor } from '../common/current-vendor.decorator';
import type { VendorRef } from '../vendor/food-vendor.service';

/** The kitchen. Another vendor's order is 404. */
@ApiTags('food · vendor')
@FoodVendor()
@Controller('food/vendor/orders')
export class VendorFoodOrdersController {
  constructor(
    private readonly views: FoodOrderViewsService,
    private readonly actions: FoodOrderActionsService,
    private readonly delivery: RiderDeliveryService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'The board (?status=new|active|done|<status>&scheduled).',
  })
  list(@CurrentVendor() v: VendorRef, @Query() q: VendorOrdersQueryDto) {
    return this.views.vendorList(v, q);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Order detail with the customer’s contact and the moves you can make.',
  })
  get(@CurrentVendor() v: VendorRef, @Param('id', ParseUUIDPipe) id: string) {
    return this.views.vendorDetail(v, id);
  }

  @Post(':id/accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'placed → accepted, with your ETA in minutes.' })
  accept(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AcceptOrderDto,
  ) {
    return this.actions.accept(v, id, dto);
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.actions.reject(v, id, dto.reason);
  }

  @Post(':id/preparing')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'accepted → preparing. A transfer order must be paid first when you require it (409 PAYMENT_NOT_CONFIRMED).',
  })
  preparing(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.actions.preparing(v, id);
  }

  @Post(':id/ready')
  @HttpCode(200)
  ready(@CurrentVendor() v: VendorRef, @Param('id', ParseUUIDPipe) id: string) {
    return this.actions.ready(v, id);
  }

  @Post(':id/assign')
  @HttpCode(200)
  @ApiOperation({
    summary:
      '{ riderId } — one of your riders, active and on duty (else 409 RIDER_NOT_AVAILABLE). Reassigning before pickup is allowed.',
  })
  assign(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignRiderDto,
  ) {
    return this.delivery.assign(v, id, dto.riderId);
  }

  @Post(':id/handed-external')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'ready → on_the_way with your own rider (no rider account). Mark it delivered later.',
  })
  handedExternal(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.actions.handedExternal(v, id);
  }

  @Post(':id/picked-up')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Pickup: ready → picked_up (pay at pickup is settled).',
  })
  pickedUp(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.actions.pickedUp(v, id);
  }

  @Post(':id/delivered')
  @HttpCode(200)
  @ApiOperation({
    summary: 'on_the_way → delivered; COD records the cash taken (≤ total).',
  })
  delivered(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeliveredDto,
  ) {
    return this.actions.delivered(v, id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'accepted | preparing | ready → cancelled (portions and promotion use go back).',
  })
  cancel(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.actions.cancel(v, id, dto.reason);
  }

  @Post(':id/payment/confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'The transfer arrived in your account → paid.' })
  confirmPayment(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.actions.confirmPayment(v, id);
  }

  @Post(':id/payment/reject')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'The proof doesn’t match → awaiting_transfer again (10 more minutes).',
  })
  rejectPayment(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.actions.rejectPayment(v, id, dto.reason);
  }
}
