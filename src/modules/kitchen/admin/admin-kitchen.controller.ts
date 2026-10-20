import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ReferenceImportDto } from '../dto/purchase.dto';
import { PriceWatchService } from '../costing/price-watch.service';
import { AliasesService } from './aliases.service';
import { AliasDto, AliasesQueryDto } from '../dto/aliases.dto';

/** Staff: reference prices (PBS SPI) and ingredient aliases. Every write is audited. */
@ApiTags('admin · kitchen')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@Controller('admin/kitchen')
export class AdminKitchenController {
  constructor(
    private readonly priceWatch: PriceWatchService,
    private readonly aliases: AliasesService,
  ) {}

  @Get('aliases')
  @ApiOperation({
    summary:
      '?q&canonical&lang&page — what people call an ingredient → its canonical name.',
  })
  listAliases(@Query() q: AliasesQueryDto) {
    return this.aliases.list(q);
  }

  @Post('aliases')
  @ApiOperation({
    summary:
      '{ alias, canonical, lang: en|roman|ur } — 409 CONFLICT when the alias already means something.',
  })
  createAlias(@Body() dto: AliasDto) {
    return this.aliases.create(dto);
  }

  @Delete('aliases/:id')
  removeAlias(@Param('id', ParseUUIDPipe) id: string) {
    return this.aliases.remove(id);
  }

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
