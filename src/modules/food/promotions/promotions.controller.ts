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
import { PromotionsService } from './promotions.service';
import {
  PromotionDto,
  PromotionQueryDto,
  UpdatePromotionDto,
} from './dto/promotion.dto';
import { FoodVendor } from '../common/food-roles.decorator';
import { CurrentVendor } from '../common/current-vendor.decorator';
import type { VendorRef } from '../vendor/food-vendor.service';

@ApiTags('food · vendor')
@FoodVendor()
@Controller('food/vendor/promotions')
export class VendorPromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  @Get()
  @ApiOperation({
    summary: 'Your promotions (?state=live|scheduled|ended|inactive).',
  })
  list(@CurrentVendor() v: VendorRef, @Query() q: PromotionQueryDto) {
    return this.promotions.list(v, q);
  }

  @Post()
  @ApiOperation({
    summary:
      'Create a deal (code null = automatic, shown on cards). Vendor-funded; counts against promotions_active.',
  })
  create(@CurrentVendor() v: VendorRef, @Body() dto: PromotionDto) {
    return this.promotions.create(v, dto);
  }

  @Get(':id')
  get(@CurrentVendor() v: VendorRef, @Param('id', ParseUUIDPipe) id: string) {
    return this.promotions.get(v, id);
  }

  @Patch(':id')
  update(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePromotionDto,
  ) {
    return this.promotions.update(v, id, dto);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  deactivate(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.promotions.deactivate(v, id);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete an unused promotion (used ones are deactivated instead).',
  })
  remove(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.promotions.remove(v, id);
  }
}
