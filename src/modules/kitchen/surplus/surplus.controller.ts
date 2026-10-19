import {
  Body,
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
import { Throttle } from '@nestjs/throttler';
import {
  FoodCustomer,
  FoodRider,
  FoodVendor,
} from '../../food/common/food-roles.decorator';
import {
  CurrentRider,
  CurrentVendor,
} from '../../food/common/current-vendor.decorator';
import type { VendorRef } from '../../food/vendor/food-vendor.service';
import type { RiderRef } from '../../food/common/rider.guard';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';
import { RequireIdempotencyKey } from '../../../common/decorators/require-idempotency-key.decorator';
import { PublicRoute } from '../../../common/decorators/public.decorator';
import {
  CollectDto,
  DonationDto,
  PackingProofDto,
  ReserveDto,
  ReservationsQueryDto,
  SurplusBoxDto,
  SurplusQueryDto,
  UpdateSurplusBoxDto,
} from '../dto/surplus.dto';
import { SurplusService } from './surplus.service';
import { PackingService } from '../packing/packing.service';

/** Bachat Box, donations and packing proof — the vendor side (Chunk 5, P4). */
@ApiTags('kitchen · bachat box & packing')
@FoodVendor()
@Controller('food/vendor/kitchen')
export class KitchenSurplusController {
  constructor(
    private readonly surplus: SurplusService,
    private readonly packing: PackingService,
  ) {}

  @Get('surplus-boxes')
  list(@CurrentVendor() v: VendorRef, @Query('status') status?: string) {
    return this.surplus.list(v, status?.slice(0, 12));
  }

  @Get('surplus-boxes/suggestion')
  @ApiOperation({
    summary:
      'In the last two hours before closing: a draft box from today’s planned portions not yet sold.',
  })
  suggestion(@CurrentVendor() v: VendorRef) {
    return this.surplus.suggestion(v);
  }

  @Post('surplus-boxes')
  @ApiOperation({
    summary:
      '{ title, description?, contentsHint?, originalValue, price, quantity, pickupFrom, pickupTo (today), tags? }',
  })
  create(@CurrentVendor() v: VendorRef, @Body() dto: SurplusBoxDto) {
    return this.surplus.create(v, dto);
  }

  @Patch('surplus-boxes/:id')
  update(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSurplusBoxDto,
  ) {
    return this.surplus.update(v, id, dto);
  }

  @Post('surplus-boxes/:id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.surplus.cancel(v, id);
  }

  @Get('surplus-reservations')
  reservations(
    @CurrentVendor() v: VendorRef,
    @Query() q: ReservationsQueryDto,
  ) {
    return this.surplus.reservations(v, q);
  }

  @Post('surplus-reservations/:id/collected')
  @HttpCode(200)
  @ApiOperation({ summary: '{ code? } — the customer showed their BB- code.' })
  collected(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CollectDto,
  ) {
    return this.surplus.collected(v, id, dto);
  }

  @Post('surplus-reservations/:id/no-show')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'After the pickup window. Three no-shows block the customer for 14 days.',
  })
  noShow(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.surplus.noShow(v, id);
  }

  @Get('donations')
  @ApiOperation({
    summary: 'Donations and “meals rescued” (collected boxes + donated meals).',
  })
  donations(@CurrentVendor() v: VendorRef) {
    return this.surplus.donations(v);
  }

  @Post('donations')
  donate(@CurrentVendor() v: VendorRef, @Body() dto: DonationDto) {
    return this.surplus.donate(v, dto);
  }

  @Post('orders/:id/packing-proof')
  @HttpCode(200)
  @ApiOperation({
    summary:
      '{ photoUrl } (a `packing_proof` upload) before the order leaves. Required for on_the_way / picked_up when requirePackingPhoto is on. aiCheck is advisory.',
  })
  packingProof(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PackingProofDto,
  ) {
    return this.packing.vendorUpload(v, id, dto);
  }
}

/** The rider photographs the packed order at pickup. */
@ApiTags('food · rider')
@FoodRider()
@Controller('food/rider')
export class RiderPackingController {
  constructor(private readonly packing: PackingService) {}

  @Post('orders/:id/packing-proof')
  @HttpCode(200)
  packingProof(
    @CurrentRider() r: RiderRef,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PackingProofDto,
  ) {
    return this.packing.riderUpload(r, id, dto);
  }
}

/** Customers: Bachat Boxes near them, reservations (pickup only). */
@ApiTags('food · bachat box')
@Controller('food/surplus')
export class CustomerSurplusController {
  constructor(private readonly surplus: SurplusService) {}

  @Get()
  @PublicRoute()
  @ApiOperation({
    summary:
      '?lat&lng[&radiusKm] — live boxes from open kitchens nearby, nearest first.',
  })
  nearby(@Query() q: SurplusQueryDto) {
    return this.surplus.nearby(q);
  }

  @Get('reservations')
  @FoodCustomer()
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.surplus.myReservations(user);
  }

  @Post('reservations/:id/cancel')
  @HttpCode(200)
  @FoodCustomer()
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.surplus.cancelMine(user, id);
  }

  @Post(':boxId/reserve')
  @FoodCustomer()
  @RequireIdempotencyKey()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary:
      '{ quantity, paymentMethod? } + Idempotency-Key — 409 SURPLUS_SOLD_OUT / SURPLUS_WINDOW_CLOSED, 403 SURPLUS_BLOCKED (3 no-shows).',
  })
  reserve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boxId', ParseUUIDPipe) boxId: string,
    @Body() dto: ReserveDto,
  ) {
    return this.surplus.reserve(user, boxId, dto);
  }
}
