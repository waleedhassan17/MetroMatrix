import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RidersService } from './riders.service';
import {
  CreateRiderDto,
  RiderStatusDto,
  UpdateRiderDto,
} from './dto/rider.dto';
import { FoodRider, FoodVendor } from '../common/food-roles.decorator';
import {
  CurrentRider,
  CurrentVendor,
} from '../common/current-vendor.decorator';
import type { VendorRef } from '../vendor/food-vendor.service';
import type { RiderRef } from '../common/rider.guard';

@ApiTags('food · vendor')
@FoodVendor()
@Controller('food/vendor/riders')
export class VendorRidersController {
  constructor(private readonly riders: RidersService) {}

  @Get()
  list(@CurrentVendor() v: VendorRef) {
    return this.riders.list(v);
  }

  @Post()
  @ApiOperation({
    summary:
      '{ fullName, phone?, vehicle? } → { rider, credential: { username, password } } — the password is shown ONCE. Counts against the plan (409 PLAN_LIMIT_REACHED).',
  })
  create(@CurrentVendor() v: VendorRef, @Body() dto: CreateRiderDto) {
    return this.riders.create(v, dto);
  }

  @Get(':id')
  get(@CurrentVendor() v: VendorRef, @Param('id', ParseUUIDPipe) id: string) {
    return this.riders.get(v, id);
  }

  @Patch(':id')
  update(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRiderDto,
  ) {
    return this.riders.update(v, id, dto);
  }

  @Patch(':id/status')
  @ApiOperation({
    summary:
      '{ status: active|inactive|on_leave } — activation needs a free seat; deactivation signs the rider out.',
  })
  status(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RiderStatusDto,
  ) {
    return this.riders.setStatus(v, id, dto);
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  @ApiOperation({
    summary:
      '→ { username, password } — shown once; the rider is signed out everywhere.',
  })
  reset(@CurrentVendor() v: VendorRef, @Param('id', ParseUUIDPipe) id: string) {
    return this.riders.resetPassword(v, id);
  }

  @Get(':id/credential')
  @ApiOperation({ summary: 'The username (passwords are never retrievable).' })
  credential(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.riders.credential(v, id);
  }
}

@ApiTags('food · rider')
@FoodRider()
@Controller('food/rider')
export class RiderSelfController {
  constructor(private readonly riders: RidersService) {}

  @Get('me')
  me(@CurrentRider() r: RiderRef) {
    return this.riders.me(r.userId);
  }
}
