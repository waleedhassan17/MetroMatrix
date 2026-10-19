import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ReferenceImportDto } from '../dto/purchase.dto';
import { PriceWatchService } from '../costing/price-watch.service';

/** Staff: reference prices (PBS SPI). More kitchen admin arrives in P12. */
@ApiTags('admin · kitchen')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@Controller('admin/kitchen')
export class AdminKitchenController {
  constructor(private readonly priceWatch: PriceWatchService) {}

  @Post('reference-prices/import')
  @HttpCode(200)
  @ApiOperation({
    summary:
      '{ csv } with header week_ending,city,item,unit,price — the weekly PBS SPI rows transcribed from the PDF. Upserts items and prices; bad rows are listed by line. Audited.',
  })
  import(@Body() dto: ReferenceImportDto) {
    return this.priceWatch.import(dto.csv);
  }

  @Get('reference-items')
  items(@Query('q') q?: string) {
    return this.priceWatch.referenceItems(q?.slice(0, 80));
  }
}
