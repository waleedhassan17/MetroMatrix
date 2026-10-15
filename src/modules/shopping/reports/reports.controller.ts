import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ReportsService } from './reports.service';
import { CreateReportDto } from './dto/report.dto';
import { ShoppingCustomer } from '../common/shopping-customer.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';

@ApiTags('shop · customer')
@ShoppingCustomer()
@Controller('shop/products')
export class ProductReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post(':id/report')
  @Throttle({ default: { limit: 10, ttl: 60 * 60_000 } })
  @ApiOperation({
    summary: '{ reason, details? } — flag a product for MetroMatrix to review.',
  })
  report(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateReportDto,
  ) {
    return this.reports.create(me.id, id, dto);
  }
}
