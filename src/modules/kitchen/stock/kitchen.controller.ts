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
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { PaginationQueryDto } from '../../../common/pagination/pagination';
import { FoodVendor } from '../../food/common/food-roles.decorator';
import { CurrentVendor } from '../../food/common/current-vendor.decorator';
import type { VendorRef } from '../../food/vendor/food-vendor.service';
import {
  IngredientDto,
  IngredientsQueryDto,
  RecipeDto,
  StockCountDto,
  StockQueryDto,
  UpdateIngredientDto,
  VariantQueryDto,
} from '../dto/stock.dto';
import { IngredientsService } from './ingredients.service';
import { StockViewsService } from './stock-views.service';
import { RecipesService } from '../recipes/recipes.service';

/**
 * Kitchen Stock (Chunk 5, P1): ingredients, stock, counts, movements and
 * recipe cards. Another vendor's ingredient or dish is 404; a non-food
 * partner is 403 WRONG_SERVICE.
 */
@ApiTags('kitchen · stock')
@FoodVendor()
@Controller('food/vendor/kitchen')
export class KitchenStockController {
  constructor(
    private readonly ingredients: IngredientsService,
    private readonly stock: StockViewsService,
    private readonly recipes: RecipesService,
    private readonly dataSource: DataSource,
  ) {}

  @Get('setup')
  @ApiOperation({
    summary:
      'Kitchen completeness: ingredients, and dishes without a recipe card (their stock is not tracked).',
  })
  async setup(@CurrentVendor() v: VendorRef) {
    const [s] = await this.dataSource.query(
      `SELECT (SELECT count(*)::int FROM kitchen_ingredients WHERE branch_id = $1 AND is_active) AS ingredients,
              (SELECT count(*)::int FROM menu_items WHERE brand_id = $2 AND is_active) AS items`,
      [v.branchId, v.brandId],
    );
    const without = await this.dataSource.query(
      `SELECT mi.id, mi.name FROM menu_items mi
        WHERE mi.brand_id = $1 AND mi.is_active
          AND NOT EXISTS (SELECT 1 FROM recipe_cards rc WHERE rc.menu_item_id = mi.id)
        ORDER BY mi.sold_30d DESC, mi.name`,
      [v.brandId],
    );
    return {
      ingredients: s.ingredients,
      items: s.items,
      itemsWithRecipe: s.items - without.length,
      itemsWithoutRecipe: without,
    };
  }

  // Ingredients
  @Get('ingredients')
  list(@CurrentVendor() v: VendorRef, @Query() q: IngredientsQueryDto) {
    return this.ingredients.list(v, q);
  }

  @Post('ingredients')
  @ApiOperation({
    summary:
      '{ name, nameUr?, category, baseUnit (g|ml|piece), customUnits?, parLevel?: {qty, unit}, openingStock?: {qty, unit, totalCost?, expiresOn?} }',
  })
  create(@CurrentVendor() v: VendorRef, @Body() dto: IngredientDto) {
    return this.ingredients.create(v, dto);
  }

  @Get('ingredients/:id')
  get(@CurrentVendor() v: VendorRef, @Param('id', ParseUUIDPipe) id: string) {
    return this.ingredients.get(v, id);
  }

  @Patch('ingredients/:id')
  update(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateIngredientDto,
  ) {
    return this.ingredients.update(v, id, dto);
  }

  @Delete('ingredients/:id')
  @ApiOperation({
    summary:
      'Deleted when nothing refers to it; otherwise switched off ({ deactivated: true }).',
  })
  remove(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ingredients.remove(v, id);
  }

  // Stock
  @Get('stock')
  @ApiOperation({
    summary:
      'On hand, value, expiring in 3 days, below par, negative (?filter=all|expiring|below_par|negative) + summary.',
  })
  overview(@CurrentVendor() v: VendorRef, @Query() q: StockQueryDto) {
    return this.stock.overview(v, q);
  }

  @Post('stock/count')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Stock take: { lines: [{ ingredientId, qty, unit }] } sets on-hand to what you counted (count_adjust movements).',
  })
  count(@CurrentVendor() v: VendorRef, @Body() dto: StockCountDto) {
    return this.stock.count(v, dto);
  }

  @Get('stock/:ingredientId/movements')
  movements(
    @CurrentVendor() v: VendorRef,
    @Param('ingredientId', ParseUUIDPipe) id: string,
    @Query() q: PaginationQueryDto,
  ) {
    return this.stock.movements(v, id, q);
  }

  @Get('stock/:ingredientId/batches')
  @ApiOperation({
    summary: 'Batches on the shelf, oldest first — what FIFO uses next.',
  })
  batches(
    @CurrentVendor() v: VendorRef,
    @Param('ingredientId', ParseUUIDPipe) id: string,
  ) {
    return this.stock.batches(v, id);
  }

  // Recipe cards
  @Get('items/:itemId/recipe')
  @ApiOperation({
    summary: 'The dish’s recipe card (?variantId for one size), or null.',
  })
  recipe(
    @CurrentVendor() v: VendorRef,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Query() q: VariantQueryDto,
  ) {
    return this.recipes.get(v, itemId, q.variantId);
  }

  @Put('items/:itemId/recipe')
  @ApiOperation({
    summary:
      '{ yieldServings?, notes?, lines: [{ ingredientId, qty, unit, optionId?, isPackaging? }] } — replaces the card; re-checks sold-out.',
  })
  putRecipe(
    @CurrentVendor() v: VendorRef,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Query() q: VariantQueryDto,
    @Body() dto: RecipeDto,
  ) {
    return this.recipes.put(v, itemId, q.variantId, dto);
  }

  @Delete('items/:itemId/recipe')
  removeRecipe(
    @CurrentVendor() v: VendorRef,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Query() q: VariantQueryDto,
  ) {
    return this.recipes.remove(v, itemId, q.variantId);
  }

  @Get('items/:itemId/servings')
  @ApiOperation({
    summary:
      'How many the stock on hand makes, per card, and which ingredient runs out first.',
  })
  servings(
    @CurrentVendor() v: VendorRef,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.recipes.servings(v, itemId);
  }
}
