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
import { ReturnsService } from './returns.service';
import {
  ApproveReturnDto,
  CreateReturnDto,
  ReceiveReturnDto,
  RejectReturnDto,
  ReturnQueryDto,
  ReturnRefundDto,
} from './dto/return.dto';
import { ShoppingCustomer } from '../common/shopping-customer.decorator';
import { ShoppingPartner } from '../common/shopping-partner.decorator';
import { CurrentStore, PartnerStore } from '../common/current-store.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';

const uuid = new ParseUUIDPipe();

@ApiTags('shop · customer')
@ShoppingCustomer()
@Controller('shop')
export class CustomerReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Post('store-orders/:id/returns')
  @ApiOperation({
    summary:
      '{ items:[{orderItemId, quantity}], reason, details?, photos? } — delivered orders inside the return window; one open return per order.',
  })
  create(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body() dto: CreateReturnDto,
  ) {
    return this.returns.create(me.id, id, dto);
  }

  @Get('returns')
  list(@CurrentUser() me: AuthenticatedUser, @Query() q: ReturnQueryDto) {
    return this.returns.customerList(me.id, q);
  }

  @Get('returns/:id')
  get(@CurrentUser() me: AuthenticatedUser, @Param('id', uuid) id: string) {
    return this.returns.customerGet(me.id, id);
  }
}

@ApiTags('shop · partner')
@ShoppingPartner()
@Controller('shop/partner/returns')
export class PartnerReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Get()
  @ApiOperation({ summary: 'Return requests: ?status&page.' })
  list(@CurrentStore() store: PartnerStore, @Query() q: ReturnQueryDto) {
    return this.returns.partnerList(store.id, q);
  }

  @Get(':id')
  get(@CurrentStore() store: PartnerStore, @Param('id', uuid) id: string) {
    return this.returns.partnerGet(store.id, id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(
    @CurrentStore() s: PartnerStore,
    @Param('id', uuid) id: string,
    @Body() dto: ApproveReturnDto,
  ) {
    return this.returns.approve(s.id, s.ownerUserId, id, dto);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @ApiOperation({ summary: '{ note } — required.' })
  reject(
    @CurrentStore() s: PartnerStore,
    @Param('id', uuid) id: string,
    @Body() dto: RejectReturnDto,
  ) {
    return this.returns.reject(s.id, s.ownerUserId, id, dto.note);
  }

  @Post(':id/receive')
  @HttpCode(200)
  @ApiOperation({
    summary:
      '{ items:[{ returnItemId, restock }] } — restocked lines write return_restock movements.',
  })
  receive(
    @CurrentStore() s: PartnerStore,
    @Param('id', uuid) id: string,
    @Body() dto: ReceiveReturnDto,
  ) {
    return this.returns.receive(s.id, s.ownerUserId, id, dto);
  }

  @Post(':id/refund')
  @HttpCode(200)
  @ApiOperation({
    summary: '{ amount, refundRef } — capped at the returned lines’ value.',
  })
  refund(
    @CurrentStore() s: PartnerStore,
    @Param('id', uuid) id: string,
    @Body() dto: ReturnRefundDto,
  ) {
    return this.returns.refund(s.id, s.ownerUserId, id, dto);
  }
}
