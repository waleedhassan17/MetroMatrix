import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { FoodVendor } from '../../food/common/food-roles.decorator';
import { CurrentVendor } from '../../food/common/current-vendor.decorator';
import type { VendorRef } from '../../food/vendor/food-vendor.service';
import {
  ExperimentDto,
  ExperimentsQueryDto,
  UpdateExperimentDto,
} from '../dto/engineering.dto';
import { EngineeringService } from './engineering.service';

/** Menu engineering and menu experiments (Chunk 5, P8). Another kitchen's experiment is 404. */
@ApiTags('kitchen · menu engineering')
@FoodVendor()
@Controller('food/vendor/kitchen')
export class KitchenEngineeringController {
  constructor(private readonly engineering: EngineeringService) {}

  @Get('menu-engineering')
  @ApiOperation({
    summary:
      'The last 30 days: each costed dish as Star / Plowhorse / Puzzle / Dog (median quantity × median contribution margin) with one action; dishes without a recipe card under needsRecipe.',
  })
  matrix(@CurrentVendor() v: VendorRef) {
    return this.engineering.matrix(v);
  }

  @Get('experiments')
  @ApiOperation({ summary: '?status=planned|running|completed|cancelled&page' })
  list(@CurrentVendor() v: VendorRef, @Query() q: ExperimentsQueryDto) {
    return this.engineering.list(v, q);
  }

  @Post('experiments')
  @ApiOperation({
    summary:
      '{ itemId, days (3–60), startsOn? (today), notes? } — one running experiment per dish (409 CONFLICT).',
  })
  create(@CurrentVendor() v: VendorRef, @Body() dto: ExperimentDto) {
    return this.engineering.create(v, dto);
  }

  @Get('experiments/:id')
  @ApiOperation({
    summary:
      'With the result: sales a day vs the category’s median dish and the forecast, food cost vs target → keep / adjust / drop (live while running).',
  })
  get(@CurrentVendor() v: VendorRef, @Param('id', ParseUUIDPipe) id: string) {
    return this.engineering.get(v, id);
  }

  @Patch('experiments/:id')
  update(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExperimentDto,
  ) {
    return this.engineering.update(v, id, dto);
  }

  @Post('experiments/:id/end')
  @HttpCode(200)
  @ApiOperation({ summary: 'End early; the result through yesterday is kept.' })
  end(@CurrentVendor() v: VendorRef, @Param('id', ParseUUIDPipe) id: string) {
    return this.engineering.end(v, id);
  }

  @Delete('experiments/:id')
  @ApiOperation({ summary: 'Cancel (no result).' })
  cancel(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.engineering.cancel(v, id);
  }
}
