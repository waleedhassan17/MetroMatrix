import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ErrorCode } from '../../../common/errors/codes';
import { OperationalAuditService } from '../../../common/audit/operational-audit.service';
import { MediaService } from '../../media/media.service';
import {
  HealthBanner,
  HealthBannerScreen,
  HealthBannerTarget,
} from '../discovery/entities/health-banner.entity';
import {
  HealthBannerDto,
  UpdateHealthBannerDto,
} from './dto/admin-banners.dto';

const notFound = () =>
  new NotFoundException({
    code: ErrorCode.NOT_FOUND,
    message: 'Banner not found.',
  });

const invalid = (field: string, message: string) =>
  new BadRequestException({
    code: ErrorCode.VALIDATION_FAILED,
    message,
    details: { fields: { [field]: [message] } },
  });

const TARGET_TABLE: Record<string, string> = {
  specialty: `SELECT name FROM specialties WHERE id = $1 AND is_active`,
  condition: `SELECT name FROM conditions WHERE id = $1 AND is_active`,
  doctor: `SELECT full_name AS name FROM doctors WHERE id = $1`,
};

export const healthBannerView = (b: HealthBanner) => ({
  id: b.id,
  imageUrl: b.imageUrl,
  title: b.title,
  subtitle: b.subtitle,
  targetType: b.targetType,
  targetId: b.targetId,
  targetScreen: b.targetScreen,
  city: b.city,
  startsAt: b.startsAt,
  endsAt: b.endsAt,
  sort: b.sort,
  isActive: b.isActive,
});

/**
 * Staff tools for the Health home's banners. A new image must be the
 * admin's own `banner` upload; a target must exist when it is saved (the
 * home drops a banner whose target has since gone away). Every write is
 * audited.
 */
@Injectable()
export class AdminBannersService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly media: MediaService,
    private readonly audit: OperationalAuditService,
  ) {}

  async list() {
    const rows = await this.dataSource.manager.find(HealthBanner, {
      order: { sort: 'ASC', createdAt: 'DESC' },
    });
    return rows.map(healthBannerView);
  }

  async create(adminId: string, dto: HealthBannerDto) {
    this.media.assertOwnedAsset(
      adminId,
      'banner',
      dto.imageUrl,
      undefined,
      'imageUrl',
    );
    const target = await this.target(
      dto.targetType,
      dto.targetId ?? null,
      dto.targetScreen ?? null,
    );
    const window = this.window(dto.startsAt ?? null, dto.endsAt ?? null);
    const m = this.dataSource.manager;
    const saved = await m.save(
      m.create(HealthBanner, {
        imageUrl: dto.imageUrl,
        title: dto.title,
        subtitle: dto.subtitle ?? null,
        ...target,
        city: dto.city ?? null,
        ...window,
        sort: dto.sort ?? 0,
        isActive: dto.isActive ?? true,
      }),
    );
    await this.audit.record({
      action: 'health.banner.create',
      targetType: 'health_banner',
      targetId: saved.id,
      before: null,
      after: healthBannerView(saved),
    });
    return healthBannerView(saved);
  }

  async update(adminId: string, id: string, dto: UpdateHealthBannerDto) {
    const m = this.dataSource.manager;
    const b = await m.findOne(HealthBanner, { where: { id } });
    if (!b) throw notFound();
    // A new image must be the admin's own upload; the current one may be re-sent.
    if (dto.imageUrl !== undefined && dto.imageUrl !== b.imageUrl) {
      this.media.assertOwnedAsset(
        adminId,
        'banner',
        dto.imageUrl,
        undefined,
        'imageUrl',
      );
    }
    const retarget =
      dto.targetType !== undefined ||
      dto.targetId !== undefined ||
      dto.targetScreen !== undefined;
    const type = dto.targetType ?? b.targetType;
    const target = retarget
      ? await this.target(
          type,
          dto.targetId !== undefined
            ? dto.targetId
            : type === b.targetType
              ? b.targetId
              : null,
          dto.targetScreen !== undefined
            ? dto.targetScreen
            : type === b.targetType
              ? b.targetScreen
              : null,
        )
      : {};
    const window = this.window(
      dto.startsAt !== undefined
        ? dto.startsAt
        : (b.startsAt?.toISOString() ?? null),
      dto.endsAt !== undefined ? dto.endsAt : (b.endsAt?.toISOString() ?? null),
    );
    const before = healthBannerView(b);
    Object.assign(b, {
      imageUrl: dto.imageUrl ?? b.imageUrl,
      title: dto.title ?? b.title,
      subtitle: dto.subtitle !== undefined ? dto.subtitle : b.subtitle,
      ...target,
      city: dto.city !== undefined ? dto.city : b.city,
      ...window,
      sort: dto.sort ?? b.sort,
      isActive: dto.isActive ?? b.isActive,
    });
    await m.save(b);
    await this.audit.record({
      action: 'health.banner.update',
      targetType: 'health_banner',
      targetId: id,
      before,
      after: healthBannerView(b),
    });
    return healthBannerView(b);
  }

  async remove(id: string) {
    const m = this.dataSource.manager;
    const b = await m.findOne(HealthBanner, { where: { id } });
    if (!b) throw notFound();
    await m.delete(HealthBanner, { id });
    await this.audit.record({
      action: 'health.banner.delete',
      targetType: 'health_banner',
      targetId: id,
      before: healthBannerView(b),
      after: null,
    });
    return { deleted: true };
  }

  /**
   * The given banners first, in this order; any left out follow in their
   * current order. Every banner's `sort` is rewritten to its position.
   */
  async reorder(ids: string[]) {
    const unique = [...new Set(ids)];
    if (unique.length !== ids.length)
      throw invalid('ids', 'Each banner may appear once.');
    let previous: string[] = [];
    let next: string[] = [];
    await this.dataSource.transaction(async (m) => {
      const all = await m.find(HealthBanner, {
        order: { sort: 'ASC', createdAt: 'DESC' },
        lock: { mode: 'pessimistic_write' },
      });
      const known = new Set(all.map((b) => b.id));
      if (unique.some((id) => !known.has(id))) throw notFound();
      const order = [
        ...unique,
        ...all.map((b) => b.id).filter((id) => !unique.includes(id)),
      ];
      for (const [i, id] of order.entries())
        await m.update(HealthBanner, { id }, { sort: i });
      previous = all.map((b) => b.id);
      next = order;
    });
    await this.audit.record({
      action: 'health.banner.reorder',
      targetType: 'health_banner',
      targetId: null,
      before: { order: previous },
      after: { order: next },
    });
    return this.list();
  }

  private window(startsAt: string | null, endsAt: string | null) {
    const s = startsAt ? new Date(startsAt) : null;
    const e = endsAt ? new Date(endsAt) : null;
    if (s && e && e <= s)
      throw invalid('endsAt', 'The end must be after the start.');
    return { startsAt: s, endsAt: e };
  }

  /** The target columns for a type, checked: the row must exist (and a specialty or condition be active). */
  private async target(
    type: HealthBannerTarget,
    id: string | null,
    screen: HealthBannerScreen | null,
  ): Promise<{
    targetType: HealthBannerTarget;
    targetId: string | null;
    targetScreen: HealthBannerScreen | null;
  }> {
    if (type === 'none')
      return { targetType: type, targetId: null, targetScreen: null };
    if (type === 'screen') {
      if (!screen)
        throw invalid('targetScreen', 'Choose the screen the banner opens.');
      return { targetType: type, targetId: null, targetScreen: screen };
    }
    if (!id) throw invalid('targetId', `Choose the ${type} the banner opens.`);
    const [row] = await this.dataSource.query(TARGET_TABLE[type], [id]);
    if (!row) throw invalid('targetId', `That ${type} does not exist.`);
    return { targetType: type, targetId: id, targetScreen: null };
  }
}
