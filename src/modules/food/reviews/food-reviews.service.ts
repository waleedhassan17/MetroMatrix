import {
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { FoodReview } from './entities/food-review.entity';
import {
  AdminFoodReviewsQueryDto,
  FoodReviewDto,
  VendorReviewsQueryDto,
} from './dto/review.dto';
import { FoodAggregatesService } from './food-aggregates.service';
import { FoodOrderTransitionsService } from '../orders/food-order-transitions.service';
import { FoodOrderViewsService } from '../orders/food-order-views.service';
import { FoodNotifier } from '../orders/food-notifier.service';
import { FoodDiscoveryService } from '../discovery/discovery.service';
import { MediaService } from '../../media/media.service';
import { ErrorCode } from '../../../common/errors/codes';
import {
  paged,
  PaginationQueryDto,
} from '../../../common/pagination/pagination';
import { OperationalAuditService } from '../../../common/audit/operational-audit.service';
import type { VendorRef } from '../vendor/food-vendor.service';

const notFound = () =>
  new NotFoundException({
    code: ErrorCode.NOT_FOUND,
    message: 'Review not found.',
  });

const firstName = (name: string | null) => (name ?? 'Customer').split(/\s+/)[0];

/**
 * One review per order, once it was delivered or collected. Ratings are
 * recomputed in the same transaction (and nightly); staff can hide a review,
 * which takes it out of every rating and list.
 */
@Injectable()
export class FoodReviewsService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly aggregates: FoodAggregatesService,
    private readonly transitions: FoodOrderTransitionsService,
    private readonly views: FoodOrderViewsService,
    private readonly notifier: FoodNotifier,
    private readonly discovery: FoodDiscoveryService,
    private readonly media: MediaService,
    private readonly audit: OperationalAuditService,
  ) {}

  onModuleInit(): void {
    this.views.canReview = async (o) =>
      (o.status === 'delivered' || o.status === 'picked_up') &&
      !(await this.dataSource.manager.exists(FoodReview, {
        where: { orderId: o.id },
      }));
    this.discovery.reviewSummary = (brandId) => this.summary(brandId);
  }

  async create(userId: string, code: string, dto: FoodReviewDto) {
    const review = await this.dataSource.transaction(async (m) => {
      const o = await this.transitions.lock(m, { code, userId });
      if (o.status !== 'delivered' && o.status !== 'picked_up')
        throw new ConflictException({
          code: ErrorCode.REVIEW_NOT_ALLOWED,
          message:
            'You can review an order once it has been delivered or collected.',
          details: { status: o.status },
        });
      if (await m.exists(FoodReview, { where: { orderId: o.id } }))
        throw new ConflictException({
          code: ErrorCode.REVIEW_EXISTS,
          message: 'You’ve already reviewed this order.',
        });
      for (const url of dto.photos ?? [])
        this.media.assertOwnedAsset(
          userId,
          'review_photo',
          url,
          undefined,
          'photos',
        );
      const r = await m.save(
        m.create(FoodReview, {
          orderId: o.id,
          brandId: o.brandId,
          userId,
          foodRating: dto.foodRating,
          deliveryRating:
            o.fulfilment === 'delivery' ? (dto.deliveryRating ?? null) : null,
          tags: [...new Set(dto.tags ?? [])],
          text: dto.text || null,
          photos: dto.photos ?? [],
        }),
      );
      await this.aggregates.ratings(m, o.brandId);
      return { r, branchId: o.branchId, code: o.code };
    });
    await this.notifier.send([
      {
        userId: await this.notifier.ownerOf(review.branchId),
        payload: {
          type: 'food.review.new',
          title: `New ${review.r.foodRating}★ review`,
          body: review.r.text
            ? review.r.text.slice(0, 120)
            : `On order ${review.code}.`,
          data: { reviewId: review.r.id, screen: 'food.vendor.reviews' },
        },
      },
    ]);
    return this.view(review.r, null);
  }

  /** The vendor page's rating block: average, count, stars, top tags, three recent. */
  async summary(brandId: string) {
    const [agg] = await this.dataSource.query(
      `SELECT rating_avg, rating_count FROM food_brands WHERE id = $1`,
      [brandId],
    );
    const stars = await this.dataSource.query(
      `SELECT food_rating AS stars, count(*)::int AS n FROM food_reviews
        WHERE brand_id = $1 AND NOT is_hidden GROUP BY food_rating`,
      [brandId],
    );
    const tags = await this.dataSource.query(
      `SELECT tag, count(*)::int AS n FROM food_reviews r, unnest(r.tags) AS tag
        WHERE r.brand_id = $1 AND NOT r.is_hidden GROUP BY tag ORDER BY n DESC, tag LIMIT 5`,
      [brandId],
    );
    const recent = await this.publicList(brandId, {
      page: 1,
      pageSize: 3,
    } as PaginationQueryDto);
    return {
      ratingAvg: parseFloat(agg?.rating_avg ?? '0'),
      ratingCount: agg?.rating_count ?? 0,
      distribution: Object.fromEntries(
        [5, 4, 3, 2, 1].map((s) => [
          s,
          stars.find((x: any) => x.stars === s)?.n ?? 0,
        ]),
      ),
      topTags: tags.map((t: any) => ({ tag: t.tag, count: t.n })),
      recent: recent.items,
    };
  }

  async publicList(brandId: string, q: PaginationQueryDto) {
    const [rows, total] = await this.dataSource
      .getRepository(FoodReview)
      .createQueryBuilder('r')
      .where('r.brand_id = :brandId AND NOT r.is_hidden', { brandId })
      .orderBy('r.createdAt', 'DESC')
      .addOrderBy('r.id', 'ASC')
      .skip((q.page - 1) * q.pageSize)
      .take(q.pageSize)
      .getManyAndCount();
    const names = await this.names(rows.map((r) => r.userId));
    return paged(
      rows.map((r) => this.view(r, firstName(names.get(r.userId) ?? null))),
      total,
      q,
    );
  }

  async vendorList(v: VendorRef, q: VendorReviewsQueryDto) {
    const qb = this.dataSource
      .getRepository(FoodReview)
      .createQueryBuilder('r')
      .where('r.brand_id = :brandId AND NOT r.is_hidden', {
        brandId: v.brandId,
      });
    if (q.unreplied === 'true') qb.andWhere('r.vendor_reply IS NULL');
    if (q.unreplied === 'false') qb.andWhere('r.vendor_reply IS NOT NULL');
    const [rows, total] = await qb
      .orderBy('r.createdAt', 'DESC')
      .addOrderBy('r.id', 'ASC')
      .skip((q.page - 1) * q.pageSize)
      .take(q.pageSize)
      .getManyAndCount();
    const names = await this.names(rows.map((r) => r.userId));
    const codes = await this.codes(rows.map((r) => r.orderId));
    return paged(
      rows.map((r) => ({
        ...this.view(r, firstName(names.get(r.userId) ?? null)),
        orderCode: codes.get(r.orderId) ?? null,
      })),
      total,
      q,
    );
  }

  async reply(v: VendorRef, id: string, text: string) {
    const r = await this.dataSource.manager.findOne(FoodReview, {
      where: { id, brandId: v.brandId, isHidden: false },
    });
    if (!r) throw notFound();
    const first = r.vendorReply === null;
    r.vendorReply = text;
    r.repliedAt = new Date();
    await this.dataSource.manager.save(r);
    if (first)
      await this.notifier.send([
        {
          userId: r.userId,
          payload: {
            type: 'food.review.reply',
            title: 'The restaurant replied to your review',
            body: text.slice(0, 140),
            data: { reviewId: r.id },
          },
        },
      ]);
    return this.view(r, null);
  }

  // ── staff ─────────────────────────────────────────────────────────────────

  async adminList(q: AdminFoodReviewsQueryDto) {
    const qb = this.dataSource
      .getRepository(FoodReview)
      .createQueryBuilder('r');
    if (q.vendorId) qb.andWhere('r.brand_id = :b', { b: q.vendorId });
    if (q.hidden === 'true') qb.andWhere('r.is_hidden');
    if (q.hidden === 'false') qb.andWhere('NOT r.is_hidden');
    if (q.maxRating) qb.andWhere('r.food_rating <= :mx', { mx: q.maxRating });
    const [rows, total] = await qb
      .orderBy('r.createdAt', 'DESC')
      .addOrderBy('r.id', 'ASC')
      .skip((q.page - 1) * q.pageSize)
      .take(q.pageSize)
      .getManyAndCount();
    const names = await this.names(rows.map((r) => r.userId));
    const codes = await this.codes(rows.map((r) => r.orderId));
    return paged(
      rows.map((r) => ({
        ...this.view(r, names.get(r.userId) ?? 'Customer'),
        vendorId: r.brandId,
        orderCode: codes.get(r.orderId) ?? null,
        isHidden: r.isHidden,
        hiddenReason: r.hiddenReason,
      })),
      total,
      q,
    );
  }

  async setHidden(id: string, hidden: boolean, reason: string | null) {
    let before: { isHidden: boolean; hiddenReason: string | null } | null =
      null;
    const r = await this.dataSource.transaction(async (m) => {
      const r = await m.findOne(FoodReview, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!r) throw notFound();
      before = { isHidden: r.isHidden, hiddenReason: r.hiddenReason };
      r.isHidden = hidden;
      r.hiddenReason = hidden ? reason : null;
      await m.save(r);
      await this.aggregates.ratings(m, r.brandId);
      return r;
    });
    await this.audit.record({
      action: hidden ? 'food.review.hide' : 'food.review.unhide',
      targetType: 'food_review',
      targetId: r.id,
      details: { vendorId: r.brandId },
      before,
      after: { isHidden: r.isHidden, hiddenReason: r.hiddenReason },
    });
    return { id: r.id, isHidden: r.isHidden, hiddenReason: r.hiddenReason };
  }

  // ── plumbing ──────────────────────────────────────────────────────────────

  private view(r: FoodReview, author: string | null) {
    return {
      id: r.id,
      author,
      foodRating: r.foodRating,
      deliveryRating: r.deliveryRating,
      tags: r.tags,
      text: r.text,
      photos: r.photos,
      vendorReply: r.vendorReply,
      repliedAt: r.repliedAt,
      createdAt: r.createdAt,
    };
  }

  private async names(ids: string[]) {
    if (!ids.length) return new Map<string, string | null>();
    const rows = await this.dataSource.query(
      `SELECT id, display_name FROM users WHERE id = ANY($1::uuid[])`,
      [[...new Set(ids)]],
    );
    return new Map<string, string | null>(
      rows.map((u: any) => [u.id, u.display_name]),
    );
  }

  private async codes(orderIds: string[]) {
    if (!orderIds.length) return new Map<string, string>();
    const rows = await this.dataSource.query(
      `SELECT id, code FROM food_orders WHERE id = ANY($1::uuid[])`,
      [orderIds],
    );
    return new Map<string, string>(rows.map((o: any) => [o.id, o.code]));
  }
}
