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
import {
  AcceptQuoteDto,
  AdvanceProofDto,
  CateringQueryDto,
  CateringReasonDto,
  CateringRequestDto,
  QuoteDto,
} from './dto/catering.dto';
import { CateringService } from './catering.service';

/** Catering — the vendor side (Chunk 5, P6). Another vendor's booking is 404. */
@ApiTags('growth · catering')
@FoodVendor()
@Controller('food/vendor/catering')
export class VendorCateringController {
  constructor(private readonly catering: CateringService) {}

  @Get()
  list(@CurrentVendor() v: VendorRef, @Query() q: CateringQueryDto) {
    return this.catering.list(v, q);
  }

  @Get(':id')
  get(@CurrentVendor() v: VendorRef, @Param('id', ParseUUIDPipe) id: string) {
    return this.catering.vendorView(v, id);
  }

  @Post(':id/quote')
  @HttpCode(200)
  @ApiOperation({
    summary:
      '{ lines: [{ menuItemId?, name, qty, unitPrice }], deliveryFee?, advancePct, validUntil? (3 days), notes? } — a new version; earlier ones can no longer be accepted.',
  })
  quote(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: QuoteDto,
  ) {
    return this.catering.quote(v, id, dto);
  }

  @Post(':id/decline')
  @HttpCode(200)
  decline(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CateringReasonDto,
  ) {
    return this.catering.decline(v, id, dto.reason);
  }

  @Post(':id/advance/confirm')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'The advance reached your account → confirmed; the order is written on the event day.',
  })
  confirm(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.catering.confirmAdvance(v, id);
  }

  @Post(':id/advance/reject')
  @HttpCode(200)
  reject(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CateringReasonDto,
  ) {
    return this.catering.rejectAdvance(v, id, dto.reason);
  }
}

/** Catering — customers. */
@ApiTags('growth · catering')
@FoodCustomer()
@Controller('food/catering')
export class CustomerCateringController {
  constructor(private readonly catering: CateringService) {}

  @Post()
  @ApiOperation({
    summary:
      '{ vendorId, eventDate, eventTime, guests, eventType, requestedItems: [{ menuItemId?, name, qty? }], budget?, fulfilment (delivery|pickup|on_site), addressId?, notes? }',
  })
  request(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CateringRequestDto,
  ) {
    return this.catering.request(user, dto);
  }

  @Get()
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.catering.mine(user);
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.catering.customerView(user, id);
  }

  @Post(':id/accept')
  @HttpCode(200)
  @ApiOperation({
    summary:
      '{ version } — only the newest, unexpired quote (409 INVALID_TRANSITION / CATERING_QUOTE_EXPIRED).',
  })
  accept(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AcceptQuoteDto,
  ) {
    return this.catering.accept(user, id, dto);
  }

  @Post(':id/advance-proof')
  @HttpCode(200)
  advance(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdvanceProofDto,
  ) {
    return this.catering.advanceProof(user, id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CateringReasonDto,
  ) {
    return this.catering.cancel(user, id, dto.reason);
  }
}
