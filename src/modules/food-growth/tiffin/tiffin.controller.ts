import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  FoodCustomer,
  FoodVendor,
} from '../../food/common/food-roles.decorator';
import { CurrentVendor } from '../../food/common/current-vendor.decorator';
import type { VendorRef } from '../../food/vendor/food-vendor.service';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';
import { RequireIdempotencyKey } from '../../../common/decorators/require-idempotency-key.decorator';
import { PublicRoute } from '../../../common/decorators/public.decorator';
import {
  SubscribeDto,
  TiffinDateDto,
  TiffinPauseDto,
  TiffinPlanDto,
  TiffinProofDto,
  TiffinReasonDto,
  TiffinSubscriptionsQueryDto,
  TomorrowQueryDto,
} from './dto/tiffin.dto';
import { TiffinService } from './tiffin.service';

/** Tiffin — the vendor side (Chunk 5, P5). Another vendor's plan or subscriber is 404. */
@ApiTags('growth · tiffin')
@FoodVendor()
@Controller('food/vendor/tiffin')
export class VendorTiffinController {
  constructor(private readonly tiffin: TiffinService) {}

  @Get('plans')
  plans(@CurrentVendor() v: VendorRef) {
    return this.tiffin.plans(v);
  }

  @Post('plans')
  @ApiOperation({
    summary:
      '{ name, description?, meal, days, period (weekly|monthly), pricePerPeriod, deliveryMode, deliveryWindowFrom/To, capacity, skipCutoffHour? (20), rotation: [{ weekday, menuItemIds, note? }] } — every served day needs a rotation.',
  })
  create(@CurrentVendor() v: VendorRef, @Body() dto: TiffinPlanDto) {
    return this.tiffin.createPlan(v, dto);
  }

  @Get('plans/:id')
  plan(@CurrentVendor() v: VendorRef, @Param('id', ParseUUIDPipe) id: string) {
    return this.tiffin.plan(v, id);
  }

  @Put('plans/:id')
  update(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TiffinPlanDto,
  ) {
    return this.tiffin.updatePlan(v, id, dto);
  }

  @Get('subscriptions')
  subscriptions(
    @CurrentVendor() v: VendorRef,
    @Query() q: TiffinSubscriptionsQueryDto,
  ) {
    return this.tiffin.subscriptions(v, q);
  }

  @Post('subscriptions/:id/approve')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'requested → active, when the plan has a free seat (else 409 TIFFIN_FULL).',
  })
  approve(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tiffin.approve(v, id);
  }

  @Post('subscriptions/:id/decline')
  @HttpCode(200)
  decline(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TiffinReasonDto,
  ) {
    return this.tiffin.decline(v, id, dto.reason);
  }

  @Post('subscriptions/:id/pause')
  @HttpCode(200)
  pause(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TiffinPauseDto,
  ) {
    return this.tiffin.vendorPause(v, id, dto.until);
  }

  @Post('subscriptions/:id/end')
  @HttpCode(200)
  end(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TiffinReasonDto,
  ) {
    return this.tiffin.end(v, id, dto.reason);
  }

  @Post('subscriptions/:id/payment/confirm')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'This period is paid (cash received, or the transfer arrived in your account).',
  })
  confirm(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tiffin.confirmPayment(v, id);
  }

  @Post('subscriptions/:id/payment/reject')
  @HttpCode(200)
  reject(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TiffinReasonDto,
  ) {
    return this.tiffin.rejectPayment(v, id, dto.reason);
  }

  @Get('tomorrow')
  @ApiOperation({
    summary:
      'Meals per plan for tomorrow (or ?date), what to cook, and when skips close.',
  })
  tomorrow(@CurrentVendor() v: VendorRef, @Query() q: TomorrowQueryDto) {
    return this.tiffin.tomorrow(v, q.date);
  }
}

/** Tiffin — customers. */
@ApiTags('growth · tiffin')
@Controller('food')
export class CustomerTiffinController {
  constructor(private readonly tiffin: TiffinService) {}

  @Get('vendors/:idOrSlug/tiffin-plans')
  @PublicRoute()
  plans(@Param('idOrSlug') idOrSlug: string) {
    return this.tiffin.vendorPlans(idOrSlug.slice(0, 80));
  }

  @Post('tiffin/subscribe')
  @FoodCustomer()
  @RequireIdempotencyKey()
  @ApiOperation({
    summary:
      '{ planId, startsOn, paymentMethod (cash_weekly|transfer_per_period), fulfilment, addressId? } + Idempotency-Key → requested (the vendor approves). 409 TIFFIN_FULL.',
  })
  subscribe(@CurrentUser() user: AuthenticatedUser, @Body() dto: SubscribeDto) {
    return this.tiffin.subscribe(user, dto);
  }

  @Get('tiffin/subscriptions')
  @FoodCustomer()
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.tiffin.mine(user);
  }

  @Post('tiffin/subscriptions/:id/skip')
  @HttpCode(200)
  @FoodCustomer()
  @ApiOperation({
    summary:
      '{ date } — before the cut-off the evening before (else 409 TIFFIN_SKIP_CUTOFF_PASSED).',
  })
  skip(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TiffinDateDto,
  ) {
    return this.tiffin.skip(user, id, dto.date, true);
  }

  @Post('tiffin/subscriptions/:id/unskip')
  @HttpCode(200)
  @FoodCustomer()
  unskip(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TiffinDateDto,
  ) {
    return this.tiffin.skip(user, id, dto.date, false);
  }

  @Post('tiffin/subscriptions/:id/pause')
  @HttpCode(200)
  @FoodCustomer()
  pause(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TiffinPauseDto,
  ) {
    return this.tiffin.pause(user, id, dto.until);
  }

  @Post('tiffin/subscriptions/:id/cancel')
  @HttpCode(200)
  @FoodCustomer()
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tiffin.cancel(user, id);
  }

  @Post('tiffin/subscriptions/:id/payment-proof')
  @HttpCode(200)
  @FoodCustomer()
  @ApiOperation({
    summary:
      '{ proofUrl (a payment_proof upload), ref? } — the vendor confirms or rejects.',
  })
  proof(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TiffinProofDto,
  ) {
    return this.tiffin.paymentProof(user, id, dto);
  }
}
