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
import { ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsOptional,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { FoodVendor } from '../../food/common/food-roles.decorator';
import { CurrentVendor } from '../../food/common/current-vendor.decorator';
import type { VendorRef } from '../../food/vendor/food-vendor.service';
import { ForecastService } from './forecast.service';
import { PrepService } from './prep.service';

class ForecastQueryDto {
  @ApiPropertyOptional({ description: 'Default today.' })
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;
  @ApiPropertyOptional({ default: 7, maximum: 14 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(14)
  days?: number;
}

class AdjustDto {
  @ApiPropertyOptional({
    nullable: true,
    description:
      'Your number of portions for that day; null = use the forecast.',
  })
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(5000)
  adjusted!: number | null;
}

class DateQueryDto {
  @ApiPropertyOptional({ description: 'Default tomorrow.' })
  @IsOptional()
  @IsISO8601({ strict: true })
  date?: string;
}

class ApplyDto {
  @IsISO8601({ strict: true }) date!: string;
}

/** Forecast, prep sheet, shopping list, suggested portions and ETA accuracy (Chunk 5, P3). */
@ApiTags('kitchen · forecast & prep')
@FoodVendor()
@Controller('food/vendor/kitchen')
export class KitchenForecastController {
  constructor(
    private readonly forecast: ForecastService,
    private readonly prep: PrepService,
  ) {}

  @Get('forecast')
  @ApiOperation({
    summary:
      'Expected portions per dish per day (learning under 14 days of history, then weighted same-weekday averages × trend × events), with yesterday’s accuracy (MAPE).',
  })
  view(@CurrentVendor() v: VendorRef, @Query() q: ForecastQueryDto) {
    return this.forecast.view(v, q.from, q.days);
  }

  @Patch('forecast/:id')
  @ApiOperation({
    summary:
      '{ adjusted } — your own number for that dish and day (prep sheet and shopping list use it).',
  })
  adjust(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustDto,
  ) {
    return this.forecast.adjust(v, id, dto.adjusted);
  }

  @Get('prep-sheet')
  @ApiOperation({
    summary:
      'Planned portions × recipe cards → ingredients by category, with what is in stock and what is short.',
  })
  prepSheet(@CurrentVendor() v: VendorRef, @Query() q: DateQueryDto) {
    return this.prep.prepSheet(v, q.date);
  }

  @Get('shopping-list')
  @ApiOperation({
    summary:
      'Need − stock + 10% buffer (topped up to par levels); `text` and `whatsappUrl` to share.',
  })
  shoppingList(@CurrentVendor() v: VendorRef, @Query() q: DateQueryDto) {
    return this.prep.shoppingList(v, q.date);
  }

  @Get('portions/suggestions')
  @ApiOperation({
    summary:
      'Home kitchens: portions per dish = the forecast’s high, capped by what the stock makes.',
  })
  suggestions(@CurrentVendor() v: VendorRef, @Query() q: DateQueryDto) {
    return this.prep.portionSuggestions(v, q.date);
  }

  @Post('portions/apply-suggestion')
  @HttpCode(200)
  @ApiOperation({
    summary:
      '{ date } (today or tomorrow) — sets each dish’s portions to the suggestion.',
  })
  apply(@CurrentVendor() v: VendorRef, @Body() dto: ApplyDto) {
    return this.prep.applySuggestions(v, dto.date);
  }

  @Get('eta-accuracy')
  @ApiOperation({
    summary:
      'On-time % of your promises (30 days) and the prep times learned per hour and order size.',
  })
  eta(@CurrentVendor() v: VendorRef) {
    return this.prep.etaAccuracy(v);
  }
}
