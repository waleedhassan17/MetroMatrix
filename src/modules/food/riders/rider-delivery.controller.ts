import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RiderDeliveryService } from './rider-delivery.service';
import { RiderLocationService } from './rider-location.service';
import {
  DutyDto,
  LocationBatchDto,
  RiderOrdersQueryDto,
} from './dto/delivery.dto';
import { DeliveredDto, ReasonDto } from '../orders/dto/order-action.dto';
import { FoodRider } from '../common/food-roles.decorator';
import { CurrentRider } from '../common/current-vendor.decorator';
import type { RiderRef } from '../common/rider.guard';

/** The Rider view. Only your own orders exist here — anyone else's is 404. */
@ApiTags('food · rider')
@FoodRider()
@Controller('food/rider')
export class RiderDeliveryController {
  constructor(
    private readonly delivery: RiderDeliveryService,
    private readonly locations: RiderLocationService,
  ) {}

  @Patch('duty')
  @ApiOperation({
    summary:
      '{ onDuty } — only on-duty riders can be assigned or share location.',
  })
  duty(@CurrentRider() r: RiderRef, @Body() dto: DutyDto) {
    return this.delivery.duty(r, dto.onDuty);
  }

  @Post('location')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'A batch of GPS fixes (the REST fallback for socket rider.location). Off duty → 409 RIDER_NOT_AVAILABLE; an order not yours → 409 RIDER_NOT_ASSIGNED.',
  })
  async location(@CurrentRider() r: RiderRef, @Body() dto: LocationBatchDto) {
    const res = await this.locations.record(r.id, dto.points);
    if (!res.ok)
      throw new ConflictException({ code: res.code, message: res.message });
    return { accepted: res.accepted };
  }

  @Get('orders')
  @ApiOperation({ summary: '?scope=active|history' })
  orders(@CurrentRider() r: RiderRef, @Query() q: RiderOrdersQueryDto) {
    return this.delivery.orders(r, q);
  }

  @Get('orders/:id')
  order(@CurrentRider() r: RiderRef, @Param('id', ParseUUIDPipe) id: string) {
    return this.delivery.order(r, id);
  }

  @Post('orders/:id/accept')
  @HttpCode(200)
  accept(@CurrentRider() r: RiderRef, @Param('id', ParseUUIDPipe) id: string) {
    return this.delivery.accept(r, id);
  }

  @Post('orders/:id/decline')
  @HttpCode(200)
  @ApiOperation({ summary: 'Hand it back to the vendor (before pickup).' })
  decline(
    @CurrentRider() r: RiderRef,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.delivery.decline(r, id, dto.reason);
  }

  @Post('orders/:id/arrived-branch')
  @HttpCode(200)
  arrivedBranch(
    @CurrentRider() r: RiderRef,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.delivery.arrivedBranch(r, id);
  }

  @Post('orders/:id/picked-up')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Food in hand: the order goes on_the_way (the kitchen must have marked it ready).',
  })
  pickedUp(
    @CurrentRider() r: RiderRef,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.delivery.pickedUp(r, id);
  }

  @Post('orders/:id/arrived-customer')
  @HttpCode(200)
  arrivedCustomer(
    @CurrentRider() r: RiderRef,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.delivery.arrivedCustomer(r, id);
  }

  @Post('orders/:id/delivered')
  @HttpCode(200)
  @ApiOperation({
    summary: '{ codCollected } — cash taken (≤ total) goes on your ledger.',
  })
  delivered(
    @CurrentRider() r: RiderRef,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeliveredDto,
  ) {
    return this.delivery.delivered(r, id, dto.codCollected);
  }

  @Get('cash')
  @ApiOperation({ summary: 'Cash you hold for the vendor, and its entries.' })
  cash(@CurrentRider() r: RiderRef) {
    return this.delivery.cash(r.id);
  }
}
