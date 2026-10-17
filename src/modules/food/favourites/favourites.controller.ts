import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FoodFavouritesService } from './favourites.service';
import { FoodCustomer } from '../common/food-roles.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';

@ApiTags('food · customer')
@FoodCustomer()
@Controller('food/favourites')
export class FoodFavouritesController {
  constructor(private readonly favourites: FoodFavouritesService) {}

  @Get()
  list(@CurrentUser() me: AuthenticatedUser) {
    return this.favourites.list(me.id);
  }

  @Post(':vendorId')
  add(
    @CurrentUser() me: AuthenticatedUser,
    @Param('vendorId', ParseUUIDPipe) vendorId: string,
  ) {
    return this.favourites.add(me.id, vendorId);
  }

  @Delete(':vendorId')
  remove(
    @CurrentUser() me: AuthenticatedUser,
    @Param('vendorId', ParseUUIDPipe) vendorId: string,
  ) {
    return this.favourites.remove(me.id, vendorId);
  }
}
