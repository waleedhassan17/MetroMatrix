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
import { ReviewsService } from './reviews.service';
import {
  CreateReviewDto,
  PartnerReviewQueryDto,
  ProductReviewQueryDto,
  ReplyDto,
} from './dto/review.dto';
import { ShoppingCustomer } from '../common/shopping-customer.decorator';
import { ShoppingPartner } from '../common/shopping-partner.decorator';
import { CurrentStore, PartnerStore } from '../common/current-store.decorator';
import { OptionalAuth } from '../../../common/decorators/optional-auth.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';

const uuid = new ParseUUIDPipe();

@ApiTags('shop · catalogue')
@OptionalAuth()
@Throttle({ default: { limit: 600, ttl: 60_000 } })
@Controller('shop/products')
export class ProductReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get(':id/reviews')
  @ApiOperation({
    summary:
      'Reviews: ?rating&withPhotos&page — plus { summary: ratingAvg, ratingCount, breakdown }.',
  })
  list(@Param('id', uuid) id: string, @Query() q: ProductReviewQueryDto) {
    return this.reviews.forProduct(id, q);
  }
}

@ApiTags('shop · customer')
@ShoppingCustomer()
@Controller('shop/order-items')
export class CustomerReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post(':id/review')
  @ApiOperation({
    summary: '{ rating, text?, photos? } — delivered lines only, once each.',
  })
  create(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body() dto: CreateReviewDto,
  ) {
    return this.reviews.create(me.id, id, dto);
  }
}

@ApiTags('shop · partner')
@ShoppingPartner()
@Controller('shop/partner/reviews')
export class PartnerReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  @ApiOperation({
    summary: 'Reviews of your products: ?rating&unreplied&page.',
  })
  list(@CurrentStore() store: PartnerStore, @Query() q: PartnerReviewQueryDto) {
    return this.reviews.partnerList(store.id, q);
  }

  @Post(':id/reply')
  @HttpCode(200)
  @ApiOperation({ summary: '{ text } — one reply, editable for 24 hours.' })
  reply(
    @CurrentStore() store: PartnerStore,
    @Param('id', uuid) id: string,
    @Body() dto: ReplyDto,
  ) {
    return this.reviews.reply(store.id, id, dto);
  }
}
