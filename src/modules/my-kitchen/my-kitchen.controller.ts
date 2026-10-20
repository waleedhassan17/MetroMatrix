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
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { FoodCustomer } from '../food/common/food-roles.decorator';
import {
  FromOrdersDto,
  MissingToBagDto,
  PantryBatchDto,
  PantryItemDto,
  PantryQueryDto,
  StatsQueryDto,
  UpdatePantryItemDto,
} from './dto/my-kitchen.dto';
import { PantryService } from './pantry.service';
import { MyKitchenRecipesService } from './my-kitchen-recipes.service';

/** My Kitchen (Chunk 5, P11): the customer's pantry, recipes and grocery compare. Another person's item is 404. */
@ApiTags('my kitchen')
@FoodCustomer()
@Controller('my-kitchen')
export class MyKitchenController {
  constructor(
    private readonly pantry: PantryService,
    private readonly recipes: MyKitchenRecipesService,
  ) {}

  @Get('pantry')
  @ApiOperation({
    summary:
      '?status=active (default)|used|expired|discarded&page — soonest expiry first.',
  })
  list(@CurrentUser() u: AuthenticatedUser, @Query() q: PantryQueryDto) {
    return this.pantry.list(u, q);
  }

  @Post('pantry')
  @ApiOperation({
    summary:
      '{ name, qty, unit, expiresOn?, notes? } (Urdu and Roman Urdu names map to a canonical one).',
  })
  add(@CurrentUser() u: AuthenticatedUser, @Body() dto: PantryItemDto) {
    return this.pantry.add(u, dto);
  }

  @Post('pantry/batch')
  @ApiOperation({
    summary: '{ items: [...] } — what a confirmed pantry voice command sends.',
  })
  batch(@CurrentUser() u: AuthenticatedUser, @Body() dto: PantryBatchDto) {
    return this.pantry.addBatch(u, dto.items);
  }

  @Get('pantry/expiring')
  @ApiOperation({
    summary: 'Active items expiring within 3 days (or past), soonest first.',
  })
  expiring(@CurrentUser() u: AuthenticatedUser) {
    return this.pantry.expiring(u);
  }

  @Get('pantry/from-orders')
  @ApiOperation({
    summary:
      'Delivered grocery order lines (30 days) not yet in your pantry — drafts with pack-size quantities and a suggested expiry.',
  })
  drafts(@CurrentUser() u: AuthenticatedUser) {
    return this.pantry.drafts(u);
  }

  @Post('pantry/from-orders')
  @ApiOperation({
    summary:
      '{ lines: [{ storeOrderItemId, expiresOn? }] } — once per order line.',
  })
  fromOrders(@CurrentUser() u: AuthenticatedUser, @Body() dto: FromOrdersDto) {
    return this.pantry.addFromOrders(u, dto);
  }

  @Patch('pantry/:id')
  update(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePantryItemDto,
  ) {
    return this.pantry.update(u, id, dto);
  }

  @Post('pantry/:id/used')
  @HttpCode(200)
  used(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.pantry.close(u, id, 'used');
  }

  @Post('pantry/:id/discard')
  @HttpCode(200)
  discard(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.pantry.close(u, id, 'discarded');
  }

  @Delete('pantry/:id')
  remove(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.pantry.remove(u, id);
  }

  @Get('stats')
  @ApiOperation({
    summary:
      '?days (30) — used vs expired vs thrown away, and what you waste most.',
  })
  stats(@CurrentUser() u: AuthenticatedUser, @Query() q: StatsQueryDto) {
    return this.pantry.stats(u, q.days);
  }

  @Post('recipes/suggest')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Recipes from your pantry, using what expires first; missing items marked, with "missing to bag" and "not cooking today?" links. AI (cached 6 h per pantry) or the recipe book.',
  })
  suggest(@CurrentUser() u: AuthenticatedUser) {
    return this.recipes.suggest(u);
  }

  @Post('missing-to-bag')
  @HttpCode(200)
  @ApiOperation({
    summary:
      '{ items: [{ name }], city? } → grocery products per item, cheapest per kg / l / piece first, with add-to-bag bodies.',
  })
  missingToBag(
    @CurrentUser() u: AuthenticatedUser,
    @Body() dto: MissingToBagDto,
  ) {
    return this.recipes.missingToBag(u, dto);
  }
}
