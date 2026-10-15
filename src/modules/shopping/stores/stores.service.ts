import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { Store } from './entities/store.entity';
import { StorePaymentAccount } from './entities/store-payment-account.entity';
import { StoreCollection } from './entities/store-collection.entity';
import {
  CreateCollectionDto,
  CreatePaymentAccountDto,
  UpdateCollectionDto,
  UpdatePaymentAccountDto,
  UpdateStoreProfileDto,
  UpdateStoreSettingsDto,
} from './dto/store.dto';
import { Business } from '../../businesses/entities/business.entity';
import {
  BusinessesService,
  slugify,
} from '../../businesses/businesses.service';
import { MediaService } from '../../media/media.service';
import { ErrorCode } from '../../../common/errors/codes';
import { isUniqueViolation } from '../../auth/auth.service';
import { onBrandColor, INK, WHITE } from '../common/contrast';
import {
  normalizeAccountNumber,
  PaymentAccountKind,
} from '../../../common/payments/payment-account.validation';

export const MAX_ACTIVE_PAYMENT_ACCOUNTS = 4;
const DEFAULT_BRAND_COLOR = INK;

const notFound = (what: string) =>
  new NotFoundException({
    code: ErrorCode.NOT_FOUND,
    message: `${what} not found.`,
  });

const invalid = (field: string, message: string) =>
  new BadRequestException({
    code: ErrorCode.VALIDATION_FAILED,
    message,
    details: { fields: { [field]: [message] } },
  });

/** "  karachi " → "Karachi"; the comparison key is lower-case. */
export const normalizeCity = (city: string): string =>
  city
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/(^|\s)\S/g, (c) => c.toUpperCase());

export const storeProfileView = (s: Store) => ({
  id: s.id,
  slug: s.slug,
  tagline: s.tagline,
  about: s.about,
  logoUrl: s.logoUrl,
  coverUrl: s.coverUrl,
  brandColor: s.brandColor,
  onBrandColor: s.onBrandColor,
  socials: s.socials,
  ratingAvg: s.ratingAvg,
  ratingCount: s.ratingCount,
  isFeatured: s.isFeatured,
  isPaused: s.isPaused,
});

export const storeSettingsView = (s: Store) => ({
  returnWindowDays: s.returnWindowDays,
  codEnabled: s.codEnabled,
  codLimit: s.codLimit,
  shippingFlatFee: s.shippingFlatFee,
  freeShippingOver: s.freeShippingOver,
  deliveryCities: s.deliveryCities,
  dispatchDaysMin: s.dispatchDaysMin,
  dispatchDaysMax: s.dispatchDaysMax,
  isPaused: s.isPaused,
  pauseMessage: s.pauseMessage,
});

export const paymentAccountView = (a: StorePaymentAccount) => ({
  id: a.id,
  kind: a.kind,
  accountTitle: a.accountTitle,
  accountNumber: a.accountNumber,
  bankName: a.bankName,
  isActive: a.isActive,
  createdAt: a.createdAt,
});

export const collectionView = (c: StoreCollection) => ({
  id: c.id,
  name: c.name,
  slug: c.slug,
  sort: c.sort,
});

/**
 * A shopping partner's store: profile, settings, payment accounts and
 * collections. Every method takes the caller's store id first and every
 * lookup is scoped to it, so another store's rows are simply "not found".
 */
@Injectable()
export class StoresService implements OnModuleInit {
  constructor(
    @InjectRepository(Store) private readonly stores: Repository<Store>,
    @InjectRepository(StorePaymentAccount)
    private readonly accounts: Repository<StorePaymentAccount>,
    @InjectRepository(StoreCollection)
    private readonly collections: Repository<StoreCollection>,
    private readonly businesses: BusinessesService,
    private readonly media: MediaService,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    // Approving a shopping business opens its store, in the same transaction.
    this.businesses.onApproved(async (m, business) => {
      if (business.serviceType === 'shopping')
        await this.ensureStore(m, business);
    });
  }

  /** Idempotent: a second call (or a concurrent one) changes nothing. */
  async ensureStore(
    m: EntityManager,
    business: Pick<Business, 'id' | 'slug'>,
  ): Promise<void> {
    await m
      .createQueryBuilder()
      .insert()
      .into(Store)
      .values({
        businessId: business.id,
        slug: business.slug,
        brandColor: DEFAULT_BRAND_COLOR,
        onBrandColor: WHITE,
        socials: {},
        deliveryCities: [],
      })
      .orIgnore()
      .execute();
  }

  /** The store of an approved shopping business, created on first use. */
  async ensureForBusinessId(businessId: string): Promise<string> {
    const found = await this.stores.findOne({
      where: { businessId },
      select: { id: true },
    });
    if (found) return found.id;
    const business = await this.dataSource
      .getRepository(Business)
      .findOneOrFail({ where: { id: businessId } });
    await this.ensureStore(this.dataSource.manager, business);
    const created = await this.stores.findOneOrFail({
      where: { businessId },
      select: { id: true },
    });
    return created.id;
  }

  async get(storeId: string): Promise<Store> {
    const store = await this.stores.findOne({ where: { id: storeId } });
    if (!store) throw notFound('Store');
    return store;
  }

  // ── Profile & settings ────────────────────────────────────────────────────

  async getProfile(storeId: string) {
    const store = await this.get(storeId);
    const business = await this.dataSource
      .getRepository(Business)
      .findOneOrFail({ where: { id: store.businessId } });
    return {
      ...storeProfileView(store),
      name: business.name,
      city: business.city,
    };
  }

  async updateProfile(
    storeId: string,
    ownerUserId: string,
    dto: UpdateStoreProfileDto,
  ) {
    const store = await this.get(storeId);
    for (const field of ['logoUrl', 'coverUrl'] as const) {
      const url = dto[field];
      if (typeof url === 'string') {
        this.media.assertOwnedAsset(
          ownerUserId,
          'store_branding',
          url,
          undefined,
          field,
        );
      }
      if (url !== undefined) store[field] = url;
    }
    if (dto.brandColor !== undefined) {
      const color = dto.brandColor.toUpperCase();
      const on = onBrandColor(color);
      if (!on) {
        throw invalid(
          'brandColor',
          'That colour is too light or too mid-toned for readable text on it. Pick a darker or a brighter shade.',
        );
      }
      store.brandColor = color;
      store.onBrandColor = on;
    }
    if (dto.tagline !== undefined) store.tagline = dto.tagline || null;
    if (dto.about !== undefined) store.about = dto.about || null;
    if (dto.socials !== undefined) store.socials = { ...dto.socials };
    await this.stores.save(store);
    return this.getProfile(storeId);
  }

  async getSettings(storeId: string) {
    return storeSettingsView(await this.get(storeId));
  }

  async updateSettings(storeId: string, dto: UpdateStoreSettingsDto) {
    const store = await this.get(storeId);
    const min = dto.dispatchDaysMin ?? store.dispatchDaysMin;
    const max = dto.dispatchDaysMax ?? store.dispatchDaysMax;
    if (min > max) {
      throw invalid(
        'dispatchDaysMax',
        'Dispatch days: the maximum cannot be below the minimum.',
      );
    }
    if (dto.deliveryCities !== undefined) {
      const seen = new Map<string, string>();
      for (const c of dto.deliveryCities) {
        const city = normalizeCity(c);
        if (city.length >= 2) seen.set(city.toLowerCase(), city);
      }
      store.deliveryCities = [...seen.values()];
    }
    const simple = [
      'returnWindowDays',
      'codEnabled',
      'codLimit',
      'shippingFlatFee',
      'freeShippingOver',
      'dispatchDaysMin',
      'dispatchDaysMax',
      'isPaused',
      'pauseMessage',
    ] as const;
    for (const key of simple) {
      if (dto[key] !== undefined) (store as any)[key] = dto[key];
    }
    if (dto.isPaused === false && dto.pauseMessage === undefined)
      store.pauseMessage = null;
    await this.stores.save(store);
    return storeSettingsView(store);
  }

  // ── Payment accounts ──────────────────────────────────────────────────────

  async listAccounts(storeId: string) {
    const rows = await this.accounts.find({
      where: { storeId },
      order: { createdAt: 'ASC' },
    });
    return rows.map(paymentAccountView);
  }

  /** The accounts a transfer order shows the customer (snapshotted at checkout). */
  activeAccounts(storeId: string, m: EntityManager = this.accounts.manager) {
    return m.find(StorePaymentAccount, {
      where: { storeId, isActive: true },
      order: { createdAt: 'ASC' },
    });
  }

  async createAccount(storeId: string, dto: CreatePaymentAccountDto) {
    const fields = this.checkAccount(dto.kind, dto.accountNumber, dto.bankName);
    const isActive = dto.isActive ?? true;
    if (isActive) await this.assertActiveRoom(storeId);
    try {
      const saved = await this.accounts.save(
        this.accounts.create({
          storeId,
          kind: dto.kind,
          accountTitle: dto.accountTitle,
          ...fields,
          isActive,
        }),
      );
      return paymentAccountView(saved);
    } catch (err) {
      if (isUniqueViolation(err)) throw this.duplicateAccount();
      throw err;
    }
  }

  async updateAccount(
    storeId: string,
    id: string,
    dto: UpdatePaymentAccountDto,
  ) {
    const account = await this.accounts.findOne({ where: { id, storeId } });
    if (!account) throw notFound('Payment account');
    const kind = dto.kind ?? account.kind;
    if (
      dto.kind !== undefined ||
      dto.accountNumber !== undefined ||
      dto.bankName !== undefined
    ) {
      Object.assign(
        account,
        this.checkAccount(
          kind,
          dto.accountNumber ?? account.accountNumber,
          dto.bankName ?? account.bankName ?? undefined,
        ),
      );
      account.kind = kind;
    }
    if (dto.accountTitle !== undefined) account.accountTitle = dto.accountTitle;
    if (dto.isActive === true && !account.isActive)
      await this.assertActiveRoom(storeId);
    if (dto.isActive !== undefined) account.isActive = dto.isActive;
    try {
      return paymentAccountView(await this.accounts.save(account));
    } catch (err) {
      if (isUniqueViolation(err)) throw this.duplicateAccount();
      throw err;
    }
  }

  async removeAccount(storeId: string, id: string): Promise<{ removed: true }> {
    // Past orders keep their own snapshot of the account; deleting is safe.
    const res = await this.accounts.delete({ id, storeId });
    if (!res.affected) throw notFound('Payment account');
    return { removed: true };
  }

  private checkAccount(
    kind: PaymentAccountKind,
    number: string,
    bankName?: string,
  ) {
    const normalized = normalizeAccountNumber(kind, number);
    if (!normalized.ok) throw invalid('accountNumber', normalized.reason);
    if (kind === 'bank' && !bankName)
      throw invalid('bankName', 'Enter the bank name.');
    return {
      accountNumber: normalized.value,
      bankName: kind === 'bank' ? bankName! : null,
    };
  }

  private async assertActiveRoom(storeId: string): Promise<void> {
    const active = await this.accounts.count({
      where: { storeId, isActive: true },
    });
    if (active >= MAX_ACTIVE_PAYMENT_ACCOUNTS) {
      throw invalid(
        'isActive',
        `A store can have at most ${MAX_ACTIVE_PAYMENT_ACCOUNTS} active payment accounts. Deactivate one first.`,
      );
    }
  }

  private duplicateAccount() {
    return new ConflictException({
      code: ErrorCode.CONFLICT,
      message: 'You have already added this account.',
    });
  }

  // ── Collections ───────────────────────────────────────────────────────────

  async listCollections(storeId: string) {
    const rows = await this.collections.find({
      where: { storeId },
      order: { sort: 'ASC', createdAt: 'ASC' },
    });
    return rows.map(collectionView);
  }

  async createCollection(storeId: string, dto: CreateCollectionDto) {
    const sort = await this.collections.count({ where: { storeId } });
    try {
      const saved = await this.collections.save(
        this.collections.create({
          storeId,
          name: dto.name,
          slug: slugify(dto.name),
          sort,
        }),
      );
      return collectionView(saved);
    } catch (err) {
      if (isUniqueViolation(err)) throw this.duplicateCollection();
      throw err;
    }
  }

  async updateCollection(
    storeId: string,
    id: string,
    dto: UpdateCollectionDto,
  ) {
    const row = await this.collections.findOne({ where: { id, storeId } });
    if (!row) throw notFound('Collection');
    if (dto.name !== undefined) {
      row.name = dto.name;
      row.slug = slugify(dto.name);
    }
    try {
      return collectionView(await this.collections.save(row));
    } catch (err) {
      if (isUniqueViolation(err)) throw this.duplicateCollection();
      throw err;
    }
  }

  async removeCollection(
    storeId: string,
    id: string,
  ): Promise<{ removed: true }> {
    // Products in it keep existing; their collection_id is set null by the FK.
    const res = await this.collections.delete({ id, storeId });
    if (!res.affected) throw notFound('Collection');
    return { removed: true };
  }

  /** `ids` in the new order; every id must be one of this store's collections. */
  async reorderCollections(storeId: string, ids: string[]) {
    await this.dataSource.transaction(async (m) => {
      const owned = await m.find(StoreCollection, {
        where: { storeId, id: In(ids) },
      });
      if (owned.length !== ids.length) throw notFound('Collection');
      for (const [index, id] of ids.entries()) {
        await m.update(StoreCollection, { id, storeId }, { sort: index });
      }
    });
    return this.listCollections(storeId);
  }

  private duplicateCollection() {
    return new ConflictException({
      code: ErrorCode.CONFLICT,
      message: 'You already have a collection with this name.',
    });
  }
}
