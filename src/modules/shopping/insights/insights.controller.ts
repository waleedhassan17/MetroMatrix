import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InsightsService } from './insights.service';
import { InsightsQueryDto } from './dto/insights.dto';
import { ShoppingPartner } from '../common/shopping-partner.decorator';
import { CurrentStore, PartnerStore } from '../common/current-store.decorator';

@ApiTags('shop · partner')
@ShoppingPartner()
@Controller('shop/partner')
export class PartnerInsightsController {
  constructor(private readonly insights: InsightsService) {}

  @Get('dashboard')
  @ApiOperation({
    summary:
      "Today's orders, to ship, awaiting payment confirmation, low stock, open returns, recorded sales (delivered totals — not money MetroMatrix holds).",
  })
  dashboard(@CurrentStore() store: PartnerStore) {
    return this.insights.dashboard(store.id);
  }

  @Get('insights')
  @ApiOperation({
    summary:
      '?range=7d|30d|90d → orders/day, recorded sales/day, top products, repeat-customer share, placed→delivered conversion.',
  })
  get(@CurrentStore() store: PartnerStore, @Query() q: InsightsQueryDto) {
    return this.insights.insights(store.id, q.range ?? '30d');
  }
}
