import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { FoodVendor } from '../../food/common/food-roles.decorator';
import { CurrentVendor } from '../../food/common/current-vendor.decorator';
import type { VendorRef } from '../../food/vendor/food-vendor.service';
import { RamadanSettingsDto } from './dto/ramadan.dto';
import { RamadanService } from './ramadan.service';

/** Ramadan hours — the vendor side (Chunk 5, P7). */
@ApiTags('growth · ramadan')
@FoodVendor()
@Controller('food/vendor/ramadan')
export class VendorRamadanController {
  constructor(private readonly ramadan: RamadanService) {}

  @Get()
  @ApiOperation({
    summary:
      '{ settings, events (Ramadan on the calendar for your city), activeToday, today } — the windows replace your weekly hours only on event dates.',
  })
  get(@CurrentVendor() v: VendorRef) {
    return this.ramadan.get(v);
  }

  @Put()
  @ApiOperation({
    summary:
      '{ enabled, sehriFrom/To?, iftarFrom/To? (HH:mm; both ends or neither), iftarPreorderOnly?, notes? }',
  })
  put(@CurrentVendor() v: VendorRef, @Body() dto: RamadanSettingsDto) {
    return this.ramadan.put(v, dto);
  }
}
