import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CatalogService } from './catalog.service';
import {
  CatalogProductQueryDto,
  CatalogStoreQueryDto,
  SuggestQueryDto,
} from './dto/catalog-query.dto';
import { OptionalAuth } from '../../../common/decorators/optional-auth.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';

const uuid = new ParseUUIDPipe();

/**
 * Browsing is read-heavy and mobile users share carrier-NAT addresses — the
 * FYP's 100-per-10-minutes limit broke real browsing. Catalogue reads get a
 * generous per-IP allowance instead of the global default.
 */
@ApiTags('shop · catalogue')
@OptionalAuth()
@Throttle({ default: { limit: 600, ttl: 60_000 } })
@Controller('shop')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('home')
  @ApiOperation({
    summary:
      '{ banners, featuredStores, newArrivals, trending, categories } — one call.',
  })
  home(@CurrentUser() user?: AuthenticatedUser) {
    return this.catalog.home(user?.id);
  }

  @Get('categories')
  @ApiOperation({ summary: 'The category tree (roots with children).' })
  categories() {
    return this.catalog.categories();
  }

  @Get('stores')
  @ApiOperation({
    summary: 'Stores: ?q&categoryId&city&featured&page&pageSize.',
  })
  stores(@Query() q: CatalogStoreQueryDto) {
    return this.catalog.stores(q);
  }

  @Get('stores/:slug')
  @ApiOperation({
    summary:
      'A storefront: profile, collections, policies (never account numbers).',
  })
  store(@Param('slug') slug: string) {
    return this.catalog.store(slug);
  }

  @Get('products')
  @ApiOperation({
    summary:
      'Products: ?q&storeId&categoryId&collectionId&minPrice&maxPrice&inStock&minRating&onSale&sort&page&pageSize.',
  })
  products(
    @Query() q: CatalogProductQueryDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.catalog.products(q, user?.id);
  }

  // Declared before :id so "suggest" is never read as an id.
  @Get('products/suggest')
  @ApiOperation({
    summary: 'Search-as-you-type: top 5 products + top 3 stores.',
  })
  suggest(@Query() q: SuggestQueryDto) {
    return this.catalog.suggest(q.q);
  }

  @Get('products/:id')
  @ApiOperation({
    summary:
      'Product detail: images, variants (stock as flags), store summary, rating breakdown.',
  })
  product(
    @Param('id', uuid) id: string,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.catalog.product(id, user?.id);
  }

  @Get('products/:id/related')
  related(@Param('id', uuid) id: string) {
    return this.catalog.related(id);
  }
}
