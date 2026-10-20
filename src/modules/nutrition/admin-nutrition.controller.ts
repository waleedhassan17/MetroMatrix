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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminNutritionService } from './admin-nutrition.service';
import {
  AdminFoodsQueryDto,
  FoodsCsvDto,
  NutritionFoodDto,
  UpdateNutritionFoodDto,
} from './dto/admin-nutrition.dto';

/** Staff: the nutrition reference foods (Chunk 5, P12). Every write is audited. */
@ApiTags('admin · nutrition')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@Controller('admin/nutrition/foods')
export class AdminNutritionController {
  constructor(private readonly foods: AdminNutritionService) {}

  @Get()
  @ApiOperation({ summary: '?q&source=usda_sr_legacy|staff&active&page' })
  list(@Query() q: AdminFoodsQueryDto) {
    return this.foods.list(q);
  }

  @Post()
  @ApiOperation({
    summary: 'Values per 100 g; source staff. 409 CONFLICT on a used key.',
  })
  create(@Body() dto: NutritionFoodDto) {
    return this.foods.create(dto);
  }

  @Post('import')
  @HttpCode(200)
  @ApiOperation({
    summary: '{ csv } — insert or update by key; bad rows by line.',
  })
  import(@Body() dto: FoodsCsvDto) {
    return this.foods.import(dto.csv);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'An edited USDA row becomes source staff (its USDA id kept).',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNutritionFoodDto,
  ) {
    return this.foods.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Deactivate (mappings keep pointing at it; it stops counting).',
  })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.foods.setActive(id, false);
  }

  @Post(':id/activate')
  @HttpCode(200)
  activate(@Param('id', ParseUUIDPipe) id: string) {
    return this.foods.setActive(id, true);
  }
}
