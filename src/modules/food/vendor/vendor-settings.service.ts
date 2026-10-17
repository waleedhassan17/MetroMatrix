import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { FoodBrand } from './entities/food-brand.entity';
import { Branch } from './entities/branch.entity';
import { BranchHours } from './entities/branch-hours.entity';
import { BranchClosure } from './entities/branch-closure.entity';
import { DeliveryFeeBand } from './entities/delivery-fee-band.entity';
import { VendorPaymentAccount } from './entities/vendor-payment-account.entity';
import {
  BusyDto,
  ClosureDto,
  FeeBandDto,
  HoursRangeDto,
  PauseDto,
  UpdateProfileDto,
  UpdateSettingsDto,
  VendorPaymentAccountDto,
  UpdateVendorPaymentAccountDto,
} from './dto/vendor.dto';
import type { VendorRef } from './food-vendor.service';
import { BranchStateService } from '../availability/branch-state.service';
import { overlappingRanges, rangesOf } from '../availability/open-state';
import { Cuisine } from '../reference/entities/cuisine.entity';
import { MediaService } from '../../media/media.service';
import { ErrorCode } from '../../../common/errors/codes';
import { onBrandColor } from '../../../common/branding/contrast';
import { normalizeAccountNumber } from '../../../common/payments/payment-account.validation';
import { formatTime12 } from '../../../common/time/time.util';

export const MAX_RANGES_PER_DAY = 4;
export const MAX_FEE_BANDS = 6;
export const MAX_ACTIVE_ACCOUNTS = 4;
const MAX_BUSY_MS = 6 * 3600_000;

const invalid = (
  field: string,
  message: string,
  details: Record<string, unknown> = {},
) =>
  new BadRequestException({
    code: ErrorCode.VALIDATION_FAILED,
    message,
    details: { fields: { [field]: [message] }, ...details },
  });

const notFound = (what: string) =>
  new NotFoundException({
    code: ErrorCode.NOT_FOUND,
    message: `${what} not found.`,
  });

export const accountView = (a: VendorPaymentAccount) => ({
  id: a.id,
  kind: a.kind,
  accountTitle: a.accountTitle,
  accountNumber: a.accountNumber,
  bankName: a.bankName,
  isActive: a.isActive,
  createdAt: a.createdAt,
});

const point = (b: Branch) =>
  b.geo ? { lat: b.geo.coordinates[1], lng: b.geo.coordinates[0] } : null;

/**
 * Everything a vendor sets up about themselves: brand profile, branch
 * settings and location, weekly hours, delivery fee bands, closures, pause
 * and busy modes, payment accounts. Every query is scoped by the vendor's
 * own brand/branch ids.
 */
@Injectable()
export class VendorSettingsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly media: MediaService,
    private readonly state: BranchStateService,
  ) {}

  private brand(m: EntityManager, v: VendorRef) {
    return m.findOneByOrFail(FoodBrand, { id: v.brandId });
  }

  private branch(m: EntityManager, v: VendorRef) {
    return m.findOneByOrFail(Branch, { id: v.branchId });
  }

  // ── Profile ──────────────────────────────────────────────────────────────

  async profile(v: VendorRef, now = new Date()) {
    const m = this.dataSource.manager;
    const [brand, branch] = await Promise.all([
      this.brand(m, v),
      this.branch(m, v),
    ]);
    const cuisines = brand.cuisineIds.length
      ? await m.find(Cuisine, { where: { id: In(brand.cuisineIds) } })
      : [];
    const schedule = (await this.state.schedules([branch.id], now)).get(
      branch.id,
    )!;
    const open = this.state.state(
      {
        id: branch.id,
        timezone: branch.timezone,
        is_paused: branch.isPaused,
        pause_message: branch.pauseMessage,
        busy_until: branch.busyUntil,
        busy_extra_minutes: branch.busyExtraMinutes,
        prep_minutes: branch.prepMinutes,
      },
      schedule,
      now,
    );
    const busy = branch.busyUntil && branch.busyUntil > now;
    return {
      id: brand.id,
      businessId: v.businessId,
      subType: v.subType,
      name: brand.name,
      slug: brand.slug,
      tagline: brand.tagline,
      logoUrl: brand.logoUrl,
      coverUrl: brand.coverUrl,
      brandColor: brand.brandColor,
      onBrandColor: brand.onBrandColor,
      cuisines: brand.cuisineIds
        .map((id) => cuisines.find((c) => c.id === id))
        .filter((c): c is Cuisine => !!c)
        .map((c) => ({ id: c.id, name: c.name, slug: c.slug, icon: c.icon })),
      priceLevel: brand.priceLevel,
      isHomeKitchen: brand.isHomeKitchen,
      ratingAvg: brand.ratingAvg,
      ratingCount: brand.ratingCount,
      branch: {
        id: branch.id,
        status: branch.status,
        isLive: branch.status === 'active',
        wentLiveAt: branch.wentLiveAt,
        foodSafetyCheckedAt: branch.foodSafetyCheckedAt,
        isPaused: branch.isPaused,
        pauseMessage: branch.pauseMessage,
        busy: busy
          ? {
              extraMinutes: branch.busyExtraMinutes,
              until: branch.busyUntil,
              label: `Busy until ${formatTime12(branch.busyUntil!, branch.timezone)} (+${branch.busyExtraMinutes} min)`,
            }
          : null,
        openState: open,
      },
    };
  }

  async updateProfile(v: VendorRef, dto: UpdateProfileDto) {
    await this.dataSource.transaction(async (m) => {
      const brand = await this.brand(m, v);
      const patch: Partial<FoodBrand> = {};
      if (dto.name !== undefined) patch.name = dto.name;
      if (dto.tagline !== undefined) patch.tagline = dto.tagline;
      for (const key of ['logoUrl', 'coverUrl'] as const) {
        const value = dto[key];
        if (value === undefined || value === brand[key]) continue;
        if (value !== null)
          this.media.assertOwnedAsset(
            v.ownerUserId,
            'food_branding',
            value,
            undefined,
            key,
          );
        patch[key] = value;
      }
      if (dto.cuisineIds !== undefined) {
        const ids = [...new Set(dto.cuisineIds)];
        const found = ids.length
          ? await m.count(Cuisine, { where: { id: In(ids), isActive: true } })
          : 0;
        if (found !== ids.length)
          throw invalid('cuisineIds', 'Pick cuisines from the list.');
        patch.cuisineIds = ids;
      }
      if (dto.priceLevel !== undefined) patch.priceLevel = dto.priceLevel;
      if (dto.brandColor !== undefined) {
        const on = onBrandColor(dto.brandColor);
        if (!on)
          throw invalid(
            'brandColor',
            'Text can’t be read on that colour. Pick a darker or lighter one.',
          );
        patch.brandColor = dto.brandColor.toUpperCase();
        patch.onBrandColor = on;
      }
      if (Object.keys(patch).length)
        await m.update(FoodBrand, { id: brand.id }, patch);
    });
    return this.profile(v);
  }

  // ── Settings ─────────────────────────────────────────────────────────────

  async settings(v: VendorRef) {
    const b = await this.branch(this.dataSource.manager, v);
    return {
      acceptsDelivery: b.acceptsDelivery,
      acceptsPickup: b.acceptsPickup,
      acceptsCod: b.acceptsCod,
      codLimit: b.codLimit,
      transferConfirmBeforePrep: b.transferConfirmBeforePrep,
      autoRejectMinutes: b.autoRejectMinutes,
      prepMinutes: b.prepMinutes,
      maxRadiusKm: b.maxRadiusKm,
      freeDeliveryOver: b.freeDeliveryOver,
      preorderOnly: b.preorderOnly,
      location: {
        addressLine: b.addressLine,
        area: b.area,
        city: b.city,
        ...(point(b) ?? { lat: null, lng: null }),
        phone: b.phone,
        timezone: b.timezone,
      },
    };
  }

  async updateSettings(v: VendorRef, dto: UpdateSettingsDto) {
    await this.dataSource.transaction(async (m) => {
      const b = await this.branch(m, v);
      const next = {
        acceptsDelivery: dto.acceptsDelivery ?? b.acceptsDelivery,
        acceptsPickup: dto.acceptsPickup ?? b.acceptsPickup,
      };
      if (!next.acceptsDelivery && !next.acceptsPickup)
        throw invalid('acceptsDelivery', 'Offer delivery, pickup or both.');
      if (dto.preorderOnly && !v.isHomeKitchen)
        throw invalid('preorderOnly', 'Pre-order only is for home kitchens.');
      if ((dto.lat === undefined) !== (dto.lng === undefined))
        throw invalid('lat', 'Send lat and lng together.');
      const patch: Partial<Branch> = {};
      for (const k of [
        'acceptsDelivery',
        'acceptsPickup',
        'acceptsCod',
        'codLimit',
        'transferConfirmBeforePrep',
        'autoRejectMinutes',
        'prepMinutes',
        'maxRadiusKm',
        'freeDeliveryOver',
        'preorderOnly',
        'addressLine',
        'area',
        'city',
        'phone',
      ] as const) {
        if (dto[k] !== undefined)
          (patch as Record<string, unknown>)[k] = dto[k];
      }
      if (Object.keys(patch).length)
        await m.update(Branch, { id: b.id }, patch);
      if (dto.lat !== undefined && dto.lng !== undefined) {
        await m.query(
          `UPDATE branches SET geo = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, updated_at = now() WHERE id = $1`,
          [b.id, dto.lng, dto.lat],
        );
      }
    });
    return this.settings(v);
  }

  // ── Hours ────────────────────────────────────────────────────────────────

  async hours(v: VendorRef) {
    const rows = await this.dataSource.manager.find(BranchHours, {
      where: { branchId: v.branchId },
      order: { weekday: 'ASC', opensAt: 'ASC' },
    });
    return rows.map((h) => ({
      weekday: h.weekday,
      opensAt: h.opensAt.slice(0, 5),
      closesAt: h.closesAt.slice(0, 5),
      overnight: h.closesAt <= h.opensAt,
    }));
  }

  /** Replaces the week. Ranges on a day may not overlap, overnight spill included. */
  async replaceHours(v: VendorRef, ranges: HoursRangeDto[]) {
    // Postgres `time` stores 24:00 as-is: a range ending at midnight that day.
    const rows = ranges;
    for (const r of rows) {
      if (r.opensAt === r.closesAt)
        throw invalid(
          'hours',
          'A range must open and close at different times.',
        );
    }
    for (let wd = 0; wd <= 6; wd++) {
      if (rows.filter((r) => r.weekday === wd).length > MAX_RANGES_PER_DAY)
        throw invalid('hours', `At most ${MAX_RANGES_PER_DAY} ranges a day.`);
    }
    const clash = overlappingRanges(rangesOf(rows));
    if (clash) {
      throw invalid('hours', 'Two of your ranges overlap.', {
        conflict: clash.map((c) => ({
          weekday: c.weekday,
          opens: c.opens,
          closes: c.closes,
        })),
      });
    }
    await this.dataSource.transaction(async (m) => {
      await m.delete(BranchHours, { branchId: v.branchId });
      if (rows.length)
        await m.insert(
          BranchHours,
          rows.map((r) => ({
            branchId: v.branchId,
            weekday: r.weekday,
            opensAt: r.opensAt,
            closesAt: r.closesAt,
          })),
        );
    });
    return this.hours(v);
  }

  // ── Delivery zones (fee bands) ───────────────────────────────────────────

  async feeBands(v: VendorRef) {
    const rows = await this.dataSource.manager.find(DeliveryFeeBand, {
      where: { branchId: v.branchId },
      order: { fromKm: 'ASC' },
    });
    return rows.map((b) => ({
      fromKm: b.fromKm,
      toKm: b.toKm,
      fee: b.fee,
      minOrder: b.minOrder,
    }));
  }

  /** Replaces the bands: from 0 km, back to back, at most 6. */
  async replaceFeeBands(v: VendorRef, bands: FeeBandDto[]) {
    const sorted = [...bands].sort((a, b) => a.fromKm - b.fromKm);
    if (sorted.length > MAX_FEE_BANDS)
      throw invalid('bands', `At most ${MAX_FEE_BANDS} bands.`);
    sorted.forEach((b, i) => {
      if (b.toKm <= b.fromKm)
        throw invalid('bands', 'Each band must end after it starts.');
      if (i === 0 && b.fromKm !== 0)
        throw invalid('bands', 'The first band starts at 0 km.');
      if (i > 0 && b.fromKm !== sorted[i - 1].toKm)
        throw invalid(
          'bands',
          'Bands must follow on from each other with no gaps.',
        );
    });
    await this.dataSource.transaction(async (m) => {
      await m.delete(DeliveryFeeBand, { branchId: v.branchId });
      if (sorted.length)
        await m.insert(
          DeliveryFeeBand,
          sorted.map((b) => ({ ...b, branchId: v.branchId })),
        );
    });
    return this.feeBands(v);
  }

  // ── Closures, pause, busy ────────────────────────────────────────────────

  async closures(v: VendorRef, now = new Date()) {
    const rows: BranchClosure[] = await this.dataSource.query(
      `SELECT id, starts_at, ends_at, reason FROM branch_closures
        WHERE branch_id = $1 AND ends_at > $2 ORDER BY starts_at`,
      [v.branchId, now],
    );
    return rows.map((c: any) => ({
      id: c.id,
      startsAt: c.starts_at,
      endsAt: c.ends_at,
      reason: c.reason,
    }));
  }

  async addClosure(v: VendorRef, dto: ClosureDto, now = new Date()) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (endsAt <= startsAt)
      throw invalid('endsAt', 'A closure must end after it starts.');
    if (endsAt <= now) throw invalid('endsAt', 'That closure is already over.');
    if (endsAt.getTime() - startsAt.getTime() > 60 * 86_400_000)
      throw invalid('endsAt', 'Closures are at most 60 days.');
    const saved = await this.dataSource.manager.save(
      this.dataSource.manager.create(BranchClosure, {
        branchId: v.branchId,
        startsAt,
        endsAt,
        reason: dto.reason ?? null,
      }),
    );
    return {
      id: saved.id,
      startsAt: saved.startsAt,
      endsAt: saved.endsAt,
      reason: saved.reason,
    };
  }

  async removeClosure(v: VendorRef, id: string) {
    const res = await this.dataSource.manager.delete(BranchClosure, {
      id,
      branchId: v.branchId,
    });
    if (!res.affected) throw notFound('Closure');
    return { removed: true };
  }

  async pause(v: VendorRef, dto: PauseDto) {
    await this.dataSource.manager.update(
      Branch,
      { id: v.branchId },
      {
        isPaused: true,
        pauseMessage: dto.message ?? null,
      },
    );
    return this.profile(v);
  }

  async resume(v: VendorRef) {
    await this.dataSource.manager.update(
      Branch,
      { id: v.branchId },
      { isPaused: false, pauseMessage: null },
    );
    return this.profile(v);
  }

  /** Busy mode adds minutes to every ETA until it ends; 0 clears it. */
  async busy(v: VendorRef, dto: BusyDto, now = new Date()) {
    if (dto.extraMinutes === 0) {
      await this.dataSource.manager.update(
        Branch,
        { id: v.branchId },
        { busyUntil: null, busyExtraMinutes: 0 },
      );
      return this.profile(v, now);
    }
    const until = dto.until
      ? new Date(dto.until)
      : new Date(now.getTime() + 3600_000);
    if (until <= now || until.getTime() - now.getTime() > MAX_BUSY_MS)
      throw invalid('until', 'Busy mode lasts up to 6 hours from now.');
    await this.dataSource.manager.update(
      Branch,
      { id: v.branchId },
      {
        busyUntil: until,
        busyExtraMinutes: dto.extraMinutes,
      },
    );
    return this.profile(v, now);
  }

  // ── Payment accounts ─────────────────────────────────────────────────────

  async accounts(v: VendorRef) {
    const rows = await this.dataSource.manager.find(VendorPaymentAccount, {
      where: { businessId: v.businessId },
      order: { createdAt: 'ASC' },
    });
    return rows.map(accountView);
  }

  async addAccount(v: VendorRef, dto: VendorPaymentAccountDto) {
    const norm = normalizeAccountNumber(dto.kind, dto.accountNumber);
    if (!norm.ok) throw invalid('accountNumber', norm.reason);
    if (dto.kind === 'bank' && !dto.bankName)
      throw invalid('bankName', 'Bank accounts need the bank name.');
    return this.dataSource.transaction(async (m) => {
      const active = await m.count(VendorPaymentAccount, {
        where: { businessId: v.businessId, isActive: true },
      });
      if ((dto.isActive ?? true) && active >= MAX_ACTIVE_ACCOUNTS)
        throw invalid(
          'isActive',
          `You can have at most ${MAX_ACTIVE_ACCOUNTS} active accounts.`,
        );
      if (
        await m.exists(VendorPaymentAccount, {
          where: { businessId: v.businessId, accountNumber: norm.value },
        })
      )
        throw new ConflictException({
          code: ErrorCode.CONFLICT,
          message: 'You already added this account.',
        });
      return accountView(
        await m.save(
          m.create(VendorPaymentAccount, {
            businessId: v.businessId,
            kind: dto.kind,
            accountTitle: dto.accountTitle,
            accountNumber: norm.value,
            bankName: dto.bankName ?? null,
            isActive: dto.isActive ?? true,
          }),
        ),
      );
    });
  }

  async updateAccount(
    v: VendorRef,
    id: string,
    dto: UpdateVendorPaymentAccountDto,
  ) {
    return this.dataSource.transaction(async (m) => {
      const a = await m.findOne(VendorPaymentAccount, {
        where: { id, businessId: v.businessId },
      });
      if (!a) throw notFound('Payment account');
      if (dto.isActive === true && !a.isActive) {
        const active = await m.count(VendorPaymentAccount, {
          where: { businessId: v.businessId, isActive: true },
        });
        if (active >= MAX_ACTIVE_ACCOUNTS)
          throw invalid(
            'isActive',
            `You can have at most ${MAX_ACTIVE_ACCOUNTS} active accounts.`,
          );
      }
      Object.assign(a, {
        accountTitle: dto.accountTitle ?? a.accountTitle,
        bankName: dto.bankName ?? a.bankName,
        isActive: dto.isActive ?? a.isActive,
      });
      return accountView(await m.save(a));
    });
  }

  async removeAccount(v: VendorRef, id: string) {
    const res = await this.dataSource.manager.delete(VendorPaymentAccount, {
      id,
      businessId: v.businessId,
    });
    if (!res.affected) throw notFound('Payment account');
    return { removed: true };
  }

  /** Accounts as shown to a customer paying by transfer. */
  async activeAccounts(m: EntityManager, businessId: string) {
    const rows = await m.find(VendorPaymentAccount, {
      where: { businessId, isActive: true },
      order: { createdAt: 'ASC' },
    });
    return rows.map((a) => ({
      kind: a.kind,
      accountTitle: a.accountTitle,
      accountNumber: a.accountNumber,
      bankName: a.bankName,
    }));
  }
}
