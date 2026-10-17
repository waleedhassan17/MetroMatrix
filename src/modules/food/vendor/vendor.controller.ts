import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseArrayPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { VendorSettingsService } from './vendor-settings.service';
import { VendorSetupService } from './vendor-setup.service';
import {
  BusyDto,
  ClosureDto,
  FeeBandDto,
  HoursRangeDto,
  PauseDto,
  UpdateProfileDto,
  UpdateSettingsDto,
  UpdateVendorPaymentAccountDto,
  VendorPaymentAccountDto,
} from './dto/vendor.dto';
import type { VendorRef } from './food-vendor.service';
import { FoodVendor } from '../common/food-roles.decorator';
import { CurrentVendor } from '../common/current-vendor.decorator';
import { validationExceptionFactory } from '../../../common/validation/validation-exception.factory';

const arrayOf = <T>(items: new () => T) =>
  new ParseArrayPipe({
    items,
    whitelist: true,
    forbidNonWhitelisted: true,
    exceptionFactory: validationExceptionFactory,
  });

@ApiTags('food · vendor')
@FoodVendor()
@Controller('food/vendor')
export class VendorController {
  constructor(
    private readonly settingsService: VendorSettingsService,
    private readonly setupService: VendorSetupService,
  ) {}

  @Get('setup')
  @ApiOperation({
    summary:
      'Go-live checklist by vendor kind: { items, percent, missing, ready, isLive }.',
  })
  setup(@CurrentVendor() v: VendorRef) {
    return this.setupService.setup(v);
  }

  @Post('go-live')
  @HttpCode(200)
  @ApiOperation({
    summary:
      '422 PROFILE_INCOMPLETE (details.missing) or FOOD_SAFETY_CHECK_REQUIRED (home kitchens).',
  })
  goLive(@CurrentVendor() v: VendorRef) {
    return this.setupService.goLive(v);
  }

  @Get('profile')
  profile(@CurrentVendor() v: VendorRef) {
    return this.settingsService.profile(v);
  }

  @Patch('profile')
  @ApiOperation({
    summary:
      '{ name?, tagline?, logoUrl?, coverUrl? (purpose food_branding), cuisineIds? (1–3), priceLevel? 1–3, brandColor? }',
  })
  updateProfile(@CurrentVendor() v: VendorRef, @Body() dto: UpdateProfileDto) {
    return this.settingsService.updateProfile(v, dto);
  }

  @Post('pause')
  @HttpCode(200)
  @ApiOperation({
    summary:
      '{ message? } — hidden from lists; the direct link shows the message.',
  })
  pause(@CurrentVendor() v: VendorRef, @Body() dto: PauseDto) {
    return this.settingsService.pause(v, dto);
  }

  @Post('resume')
  @HttpCode(200)
  resume(@CurrentVendor() v: VendorRef) {
    return this.settingsService.resume(v);
  }

  @Post('busy')
  @HttpCode(200)
  @ApiOperation({
    summary:
      '{ extraMinutes (0 clears), until? } — adds minutes to every ETA until then.',
  })
  busy(@CurrentVendor() v: VendorRef, @Body() dto: BusyDto) {
    return this.settingsService.busy(v, dto);
  }

  @Get('settings')
  settings(@CurrentVendor() v: VendorRef) {
    return this.settingsService.settings(v);
  }

  @Patch('settings')
  @ApiOperation({
    summary:
      'Fulfilment (delivery/pickup), COD + limit, transfer-before-prep rule, auto-reject minutes (3–10), prep minutes, radius, free-delivery threshold, pre-order only (home kitchens), location (address, lat/lng, phone).',
  })
  updateSettings(
    @CurrentVendor() v: VendorRef,
    @Body() dto: UpdateSettingsDto,
  ) {
    return this.settingsService.updateSettings(v, dto);
  }

  @Get('hours')
  hours(@CurrentVendor() v: VendorRef) {
    return this.settingsService.hours(v);
  }

  @Put('hours')
  @ApiBody({ type: [HoursRangeDto] })
  @ApiOperation({
    summary:
      '[{ weekday, opensAt, closesAt }] replaces the week. closesAt earlier than opensAt = past midnight. Several ranges a day.',
  })
  replaceHours(
    @CurrentVendor() v: VendorRef,
    @Body(arrayOf(HoursRangeDto)) ranges: HoursRangeDto[],
  ) {
    return this.settingsService.replaceHours(v, ranges);
  }

  @Get('fee-bands')
  feeBands(@CurrentVendor() v: VendorRef) {
    return this.settingsService.feeBands(v);
  }

  @Put('fee-bands')
  @ApiBody({ type: [FeeBandDto] })
  @ApiOperation({
    summary:
      '[{ fromKm, toKm, fee, minOrder }] — from 0 km, back to back, at most 6.',
  })
  replaceFeeBands(
    @CurrentVendor() v: VendorRef,
    @Body(arrayOf(FeeBandDto)) bands: FeeBandDto[],
  ) {
    return this.settingsService.replaceFeeBands(v, bands);
  }

  @Get('closures')
  closures(@CurrentVendor() v: VendorRef) {
    return this.settingsService.closures(v);
  }

  @Post('closures')
  addClosure(@CurrentVendor() v: VendorRef, @Body() dto: ClosureDto) {
    return this.settingsService.addClosure(v, dto);
  }

  @Delete('closures/:id')
  removeClosure(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.settingsService.removeClosure(v, id);
  }

  @Get('payment-accounts')
  accounts(@CurrentVendor() v: VendorRef) {
    return this.settingsService.accounts(v);
  }

  @Post('payment-accounts')
  addAccount(
    @CurrentVendor() v: VendorRef,
    @Body() dto: VendorPaymentAccountDto,
  ) {
    return this.settingsService.addAccount(v, dto);
  }

  @Patch('payment-accounts/:id')
  updateAccount(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVendorPaymentAccountDto,
  ) {
    return this.settingsService.updateAccount(v, id, dto);
  }

  @Delete('payment-accounts/:id')
  removeAccount(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.settingsService.removeAccount(v, id);
  }
}
