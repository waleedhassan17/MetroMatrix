import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { StoresService } from './stores.service';
import {
  CreateCollectionDto,
  CreatePaymentAccountDto,
  ReorderCollectionsDto,
  UpdateCollectionDto,
  UpdatePaymentAccountDto,
  UpdateStoreProfileDto,
  UpdateStoreSettingsDto,
} from './dto/store.dto';
import { ShoppingPartner } from '../common/shopping-partner.decorator';
import { CurrentStore, PartnerStore } from '../common/current-store.decorator';

const uuid = new ParseUUIDPipe();

@ApiTags('shop · partner')
@ShoppingPartner()
@Controller('shop/partner')
export class PartnerStoreController {
  constructor(private readonly stores: StoresService) {}

  // ── Store profile & settings ──────────────────────────────────────────────

  @Get('store')
  @ApiOperation({ summary: 'Your store profile and branding.' })
  getStore(@CurrentStore() store: PartnerStore) {
    return this.stores.getProfile(store.id);
  }

  @Patch('store')
  @ApiOperation({
    summary: 'Update profile/branding. brandColor must pass AA contrast.',
  })
  updateStore(
    @CurrentStore() store: PartnerStore,
    @Body() dto: UpdateStoreProfileDto,
  ) {
    return this.stores.updateProfile(store.id, store.ownerUserId, dto);
  }

  @Get('store/settings')
  getSettings(@CurrentStore() store: PartnerStore) {
    return this.stores.getSettings(store.id);
  }

  @Patch('store/settings')
  @ApiOperation({
    summary: 'Shipping, delivery cities, return window, COD, pause.',
  })
  updateSettings(
    @CurrentStore() store: PartnerStore,
    @Body() dto: UpdateStoreSettingsDto,
  ) {
    return this.stores.updateSettings(store.id, dto);
  }

  // ── Payment accounts ──────────────────────────────────────────────────────

  @Get('store/payment-accounts')
  listAccounts(@CurrentStore() store: PartnerStore) {
    return this.stores.listAccounts(store.id);
  }

  @Post('store/payment-accounts')
  @ApiOperation({
    summary:
      'Add a Raast / JazzCash / Easypaisa / bank account (max 4 active).',
  })
  createAccount(
    @CurrentStore() store: PartnerStore,
    @Body() dto: CreatePaymentAccountDto,
  ) {
    return this.stores.createAccount(store.id, dto);
  }

  @Patch('store/payment-accounts/:id')
  updateAccount(
    @CurrentStore() store: PartnerStore,
    @Param('id', uuid) id: string,
    @Body() dto: UpdatePaymentAccountDto,
  ) {
    return this.stores.updateAccount(store.id, id, dto);
  }

  @Delete('store/payment-accounts/:id')
  removeAccount(
    @CurrentStore() store: PartnerStore,
    @Param('id', uuid) id: string,
  ) {
    return this.stores.removeAccount(store.id, id);
  }

  // ── Collections ───────────────────────────────────────────────────────────

  @Get('collections')
  listCollections(@CurrentStore() store: PartnerStore) {
    return this.stores.listCollections(store.id);
  }

  @Post('collections')
  createCollection(
    @CurrentStore() store: PartnerStore,
    @Body() dto: CreateCollectionDto,
  ) {
    return this.stores.createCollection(store.id, dto);
  }

  // Declared before :id so "reorder" is never read as an id.
  @Patch('collections/reorder')
  @ApiOperation({ summary: '{ ids } in the new display order.' })
  reorder(
    @CurrentStore() store: PartnerStore,
    @Body() dto: ReorderCollectionsDto,
  ) {
    return this.stores.reorderCollections(store.id, dto.ids);
  }

  @Patch('collections/:id')
  updateCollection(
    @CurrentStore() store: PartnerStore,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateCollectionDto,
  ) {
    return this.stores.updateCollection(store.id, id, dto);
  }

  @Delete('collections/:id')
  removeCollection(
    @CurrentStore() store: PartnerStore,
    @Param('id', uuid) id: string,
  ) {
    return this.stores.removeCollection(store.id, id);
  }
}
