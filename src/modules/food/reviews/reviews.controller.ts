import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { FoodReviewsService } from './food-reviews.service';
import {
  FoodReviewDto,
  ReplyDto,
  VendorReviewsQueryDto,
} from './dto/review.dto';
import { FoodCustomer, FoodVendor } from '../common/food-roles.decorator';
import { CurrentVendor } from '../common/current-vendor.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';
import { OptionalAuth } from '../../../common/decorators/optional-auth.decorator';
import { PaginationQueryDto } from '../../../common/pagination/pagination';
import type { VendorRef } from '../vendor/food-vendor.service';

@ApiTags('food · customer')
@FoodCustomer()
@Controller('food/orders')
export class CustomerFoodReviewsController {
  constructor(private readonly reviews: FoodReviewsService) {}

  @Post(':code/review')
  @ApiOperation({
    summary:
      'Once, after delivery or pickup: food rating, delivery rating (delivery orders), tags, text, photos. 409 REVIEW_EXISTS / REVIEW_NOT_ALLOWED.',
  })
  create(
    @CurrentUser() me: AuthenticatedUser,
    @Param('code') code: string,
    @Body() dto: FoodReviewDto,
  ) {
    return this.reviews.create(me.id, code, dto);
  }
}

@ApiTags('food · discovery')
@OptionalAuth()
@Throttle({ default: { limit: 600, ttl: 60_000 } })
@Controller('food/vendors')
export class PublicFoodReviewsController {
  constructor(private readonly reviews: FoodReviewsService) {}

  @Get(':id/reviews')
  @ApiOperation({ summary: 'A vendor’s visible reviews, newest first.' })
  list(@Param('id', ParseUUIDPipe) id: string, @Query() q: PaginationQueryDto) {
    return this.reviews.publicList(id, q);
  }
}

@ApiTags('food · vendor')
@FoodVendor()
@Controller('food/vendor/reviews')
export class VendorFoodReviewsController {
  constructor(private readonly reviews: FoodReviewsService) {}

  @Get()
  @ApiOperation({ summary: '?unreplied=true for the ones waiting on you.' })
  list(@CurrentVendor() v: VendorRef, @Query() q: VendorReviewsQueryDto) {
    return this.reviews.vendorList(v, q);
  }

  @Post(':id/reply')
  @HttpCode(200)
  reply(
    @CurrentVendor() v: VendorRef,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplyDto,
  ) {
    return this.reviews.reply(v, id, dto.reply);
  }
}
