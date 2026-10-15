import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProductsService } from './products.service';
import {
  CreateProductDto,
  PartnerProductQueryDto,
  UpdateProductDto,
} from './dto/product.dto';
import { ShoppingPartner } from '../common/shopping-partner.decorator';
import { CurrentStore, PartnerStore } from '../common/current-store.decorator';

const uuid = new ParseUUIDPipe();

@ApiTags('shop · partner')
@ShoppingPartner()
@Controller('shop/partner/products')
export class PartnerProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @ApiOperation({
    summary: 'Your products: ?status&q&collectionId&lowStock&page&pageSize.',
  })
  list(
    @CurrentStore() store: PartnerStore,
    @Query() q: PartnerProductQueryDto,
  ) {
    return this.products.list(store.id, q);
  }

  @Post()
  @ApiOperation({
    summary:
      'Create a product with images and variants. salePrice < basePrice; publishing needs ≥ 1 image.',
  })
  create(@CurrentStore() store: PartnerStore, @Body() dto: CreateProductDto) {
    return this.products.create(store.id, store.ownerUserId, dto);
  }

  @Get(':id')
  get(@CurrentStore() store: PartnerStore, @Param('id', uuid) id: string) {
    return this.products.get(store.id, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Edit. images replaces the list; variants is the full desired set.',
  })
  update(
    @CurrentStore() store: PartnerStore,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.products.update(store.id, store.ownerUserId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Archive if it was ever ordered, otherwise delete.',
  })
  remove(@CurrentStore() store: PartnerStore, @Param('id', uuid) id: string) {
    return this.products.remove(store.id, id);
  }

  @Post(':id/duplicate')
  @ApiOperation({
    summary: 'A draft copy with the same details and images, zero stock.',
  })
  duplicate(
    @CurrentStore() store: PartnerStore,
    @Param('id', uuid) id: string,
  ) {
    return this.products.duplicate(store.id, store.ownerUserId, id);
  }
}
