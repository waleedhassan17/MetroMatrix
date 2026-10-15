import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseArrayPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InventoryService } from './inventory.service';
import {
  AdjustStockDto,
  BulkStockRowDto,
  InventoryQueryDto,
} from './dto/inventory.dto';
import { ShoppingPartner } from '../common/shopping-partner.decorator';
import { CurrentStore, PartnerStore } from '../common/current-store.decorator';
import { PaginationQueryDto } from '../../../common/pagination/pagination';
import { ErrorCode } from '../../../common/errors/codes';
import { validationExceptionFactory } from '../../../common/validation/validation-exception.factory';

const uuid = new ParseUUIDPipe();
const MAX_BULK = 200;

@ApiTags('shop · partner')
@ShoppingPartner()
@Controller('shop/partner/inventory')
export class PartnerInventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  @ApiOperation({
    summary: 'Variants with exact stock: ?lowStock&q&page&pageSize.',
  })
  list(@CurrentStore() store: PartnerStore, @Query() q: InventoryQueryDto) {
    return this.inventory.list(store.id, q);
  }

  @Post('bulk')
  @HttpCode(200)
  @ApiBody({ type: [BulkStockRowDto] })
  @ApiOperation({
    summary: '[{ variantId, setTo }] up to 200 — all applied or none.',
  })
  bulk(
    @CurrentStore() store: PartnerStore,
    @Body(
      new ParseArrayPipe({
        items: BulkStockRowDto,
        whitelist: true,
        exceptionFactory: validationExceptionFactory,
      }),
    )
    rows: BulkStockRowDto[],
  ) {
    if (rows.length < 1 || rows.length > MAX_BULK) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `Send between 1 and ${MAX_BULK} rows.`,
      });
    }
    return this.inventory.bulk(store.id, store.ownerUserId, rows);
  }

  @Patch(':variantId')
  @ApiOperation({
    summary: '{ delta } or { setTo } — recorded as a manual movement.',
  })
  adjust(
    @CurrentStore() store: PartnerStore,
    @Param('variantId', uuid) variantId: string,
    @Body() dto: AdjustStockDto,
  ) {
    return this.inventory.adjust(store.id, store.ownerUserId, variantId, dto);
  }

  @Get(':variantId/movements')
  movements(
    @CurrentStore() store: PartnerStore,
    @Param('variantId', uuid) variantId: string,
    @Query() q: PaginationQueryDto,
  ) {
    return this.inventory.movementsOf(store.id, variantId, q);
  }
}
