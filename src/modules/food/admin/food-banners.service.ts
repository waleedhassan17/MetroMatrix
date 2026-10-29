import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { FoodBanner } from './entities/food-banner.entity';
import { FoodBannerDto, UpdateFoodBannerDto } from './dto/admin-food.dto';
import {
  FoodDiscoveryService,
  VISIBLE_VENDOR_SQL,
} from '../discovery/discovery.service';
import { MediaService } from '../../media/media.service';
import { ErrorCode } from '../../../common/errors/codes';
import { OperationalAuditService } from '../../../common/audit/operational-audit.service';

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

export const foodBannerView = (b: FoodBanner) => ({
  id: b.id,
  imageUrl: b.imageUrl,
  title: b.title,
  subtitle: b.subtitle,
  targetType: b.targetType,
  targetId: b.targetId,
  targetQuery: b.targetQuery,
  city: b.city,
  startsAt: b.startsAt,
  endsAt: b.endsAt,
  sort: b.sort,
  isActive: b.isActive,
});

/**
 * The Food home's banners: staff CRUD (own `banner` uploads, a target that
 * exists, audited) and the live set the home shows — between their dates,
 * for the city or everywhere, whose vendor or cuisine is still there.
 */
@Injectable()
export class FoodBannersService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly discovery: FoodDiscoveryService,
    private readonly media: MediaService,
    private readonly audit: OperationalAuditService,
  ) {}

  onModuleInit(): void {
    this.discovery.banners = (city, now) => this.live(city, now);
  }

  async live(city: string | null, now = new Date()) {
    const rows: FoodBanner[] = await this.dataSource
      .getRepository(FoodBanner)
      .createQueryBuilder('b')
      .where('b.is_active AND b.starts_at <= :now', { now })
      .andWhere('(b.ends_at IS NULL OR b.ends_at > :now)', { now })
      .andWhere('(b.city IS NULL OR lower(b.city) = lower(:city))', {
        city: city ?? '',
      })
      .orderBy('b.sort', 'ASC')
      .addOrderBy('b.createdAt', 'DESC')
      .getMany();
    const out = [];
    for (const b of rows) {
      const target = await this.target(b);
      if (target) out.push({ ...foodBannerView(b), target });
    }
    return out;
  }

  async list() {
    const rows = await this.dataSource.manager.find(FoodBanner, {
      order: { sort: 'ASC', createdAt: 'DESC' },
    });
    return rows.map(foodBannerView);
  }

  async create(adminId: string, dto: FoodBannerDto) {
    this.media.assertOwnedAsset(
      adminId,
      'banner',
      dto.imageUrl,
      undefined,
      'imageUrl',
    );
    const b = this.dataSource.manager.create(FoodBanner, {
      imageUrl: dto.imageUrl,
      title: dto.title,
      subtitle: dto.subtitle ?? null,
      targetType: dto.targetType,
      targetId: dto.targetId ?? null,
      targetQuery: dto.targetQuery ?? null,
      city: dto.city ?? null,
      startsAt: dto.startsAt ? new Date(dto.startsAt) : new Date(),
      endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
      sort: dto.sort ?? 0,
      isActive: dto.isActive ?? true,
    });
    await this.check(b);
    const saved = await this.dataSource.manager.save(b);
    await this.audit.record({
      action: 'food.banner.create',
      targetType: 'food_banner',
      targetId: saved.id,
      before: null,
      after: foodBannerView(saved),
    });
    return foodBannerView(saved);
  }

  async update(adminId: string, id: string, dto: UpdateFoodBannerDto) {
    const b = await this.dataSource.manager.findOne(FoodBanner, {
      where: { id },
    });
    if (!b) throw notFound();
    const before = foodBannerView(b);
    if (dto.imageUrl !== undefined && dto.imageUrl !== b.imageUrl) {
      this.media.assertOwnedAsset(
        adminId,
        'banner',
        dto.imageUrl,
        undefined,
        'imageUrl',
      );
      b.imageUrl = dto.imageUrl;
    }
    if (dto.title !== undefined) b.title = dto.title;
    if (dto.subtitle !== undefined) b.subtitle = dto.subtitle;
    if (dto.targetType !== undefined) b.targetType = dto.targetType;
    if (dto.targetId !== undefined) b.targetId = dto.targetId;
    if (dto.targetQuery !== undefined) b.targetQuery = dto.targetQuery;
    if (dto.city !== undefined) b.city = dto.city;
    if (dto.startsAt !== undefined) b.startsAt = new Date(dto.startsAt);
    if (dto.endsAt !== undefined)
      b.endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    if (dto.sort !== undefined) b.sort = dto.sort;
    if (dto.isActive !== undefined) b.isActive = dto.isActive;
    await this.check(b);
    const saved = await this.dataSource.manager.save(b);
    await this.audit.record({
      action: 'food.banner.update',
      targetType: 'food_banner',
      targetId: id,
      before,
      after: foodBannerView(saved),
    });
    return foodBannerView(saved);
  }

  async remove(id: string) {
    const b = await this.dataSource.manager.findOne(FoodBanner, {
      where: { id },
    });
    if (!b) throw notFound();
    await this.dataSource.manager.delete(FoodBanner, { id });
    await this.audit.record({
      action: 'food.banner.delete',
      targetType: 'food_banner',
      targetId: id,
      before: foodBannerView(b),
      after: null,
    });
    return { deleted: true };
  }

  private async check(b: FoodBanner) {
    if (b.endsAt && b.endsAt <= b.startsAt)
      throw invalid('endsAt', 'A banner must end after it starts.');
    if (b.targetType === 'search') {
      if (!b.targetQuery)
        throw invalid('targetQuery', 'A search banner needs targetQuery.');
      b.targetId = null;
      return;
    }
    if (!b.targetId)
      throw invalid('targetId', `A ${b.targetType} banner needs targetId.`);
    b.targetQuery = null;
    if (!(await this.target(b)))
      throw invalid('targetId', `That ${b.targetType} isn’t on Food Court.`);
  }

  /** What the banner opens, if it still exists. */
  private async target(b: FoodBanner) {
    if (b.targetType === 'search')
      return { type: 'search', query: b.targetQuery };
    if (b.targetType === 'cuisine') {
      const [c] = await this.dataSource.query(
        `SELECT id, slug, name FROM cuisines WHERE id = $1 AND is_active`,
        [b.targetId],
      );
      return c
        ? { type: 'cuisine', id: c.id, slug: c.slug, name: c.name }
        : null;
    }
    const [v] = await this.dataSource.query(
      `SELECT fb.id, fb.slug, fb.name FROM food_brands fb JOIN branches br ON br.brand_id = fb.id
         JOIN businesses b ON b.id = fb.business_id WHERE fb.id = $1 AND ${VISIBLE_VENDOR_SQL}`,
      [b.targetId],
    );
    return v ? { type: 'vendor', id: v.id, slug: v.slug, name: v.name } : null;
  }
}
