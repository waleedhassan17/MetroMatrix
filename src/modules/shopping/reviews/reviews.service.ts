import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { ProductReview } from './entities/product-review.entity';
import {
  CreateReviewDto,
  PartnerReviewQueryDto,
  ProductReviewQueryDto,
  ReplyDto,
} from './dto/review.dto';
import { ErrorCode } from '../../../common/errors/codes';
import { paged } from '../../../common/pagination/pagination';
import { MediaService } from '../../media/media.service';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  PRODUCT_FROM_SQL,
  SqlParams,
  VISIBLE_PRODUCT_SQL,
} from '../common/catalog-sql';

/** A store may edit its reply for this long after first posting it. */
export const REPLY_EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

export type RatingBreakdown = Record<1 | 2 | 3 | 4 | 5, number>;

const notFound = (what = 'Review') =>
  new NotFoundException({
    code: ErrorCode.NOT_FOUND,
    message: `${what} not found.`,
  });

/** "Ayesha K." — enough to feel real, not enough to find someone. */
export function publicName(
  displayName: string | null,
  deleted: boolean,
): string {
  if (deleted || !displayName?.trim()) return 'Verified buyer';
  const [first, ...rest] = displayName.trim().split(/\s+/);
  const last = rest.pop();
  return last ? `${first} ${last[0].toUpperCase()}.` : first;
}

/**
 * Verified-purchase reviews. A line can be reviewed once, after it was
 * delivered. Creating, hiding or unhiding a review recomputes the product's
 * and the store's rating in the same transaction, under row locks taken in a
 * fixed order (product, then store) so concurrent reviews can't lose updates.
 */
@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly media: MediaService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(userId: string, orderItemId: string, dto: CreateReviewDto) {
    const created = await this.dataSource.transaction(async (m) => {
      const [line] = await m.query(
        `SELECT i.id, i.product_id, i.variant_label, so.store_id, so.status, so.user_id, so.code
           FROM store_order_items i JOIN store_orders so ON so.id = i.store_order_id
          WHERE i.id = $1`,
        [orderItemId],
      );
      if (!line || line.user_id !== userId) throw notFound('Order item');
      if (line.status !== 'delivered' && line.status !== 'completed') {
        throw new ForbiddenException({
          code: ErrorCode.REVIEW_NOT_ALLOWED,
          message: 'You can review an item once it has been delivered.',
          details: { status: line.status },
        });
      }
      const photos = dto.photos ?? [];
      photos.forEach((url, n) =>
        this.media.assertOwnedAsset(
          userId,
          'review_photo',
          url,
          undefined,
          `photos.${n}`,
        ),
      );
      await this.lockTargets(m, line.product_id, line.store_id);
      if (
        await m.exists(ProductReview, {
          where: { storeOrderItemId: orderItemId },
        })
      )
        throw this.exists();
      let review: ProductReview;
      try {
        review = await m.save(
          m.create(ProductReview, {
            storeOrderItemId: orderItemId,
            productId: line.product_id,
            storeId: line.store_id,
            userId,
            rating: dto.rating,
            text: dto.text || null,
            photos,
          }),
        );
      } catch (err) {
        if ((err as { code?: string }).code === '23505') throw this.exists();
        throw err;
      }
      await this.recompute(m, line.product_id, line.store_id);
      const [owner] = await m.query(
        `SELECT b.owner_user_id FROM stores s JOIN businesses b ON b.id = s.business_id WHERE s.id = $1`,
        [line.store_id],
      );
      return {
        review,
        ownerId: owner.owner_user_id as string,
        code: line.code as string,
      };
    });
    try {
      await this.notifications.notify(created.ownerId, {
        type: 'shop.review.new',
        title: `New ${created.review.rating}★ review`,
        body: created.review.text?.slice(0, 120) || `On order ${created.code}`,
        data: {
          reviewId: created.review.id,
          productId: created.review.productId,
        },
      });
    } catch (err) {
      this.logger.warn(`notification failed: ${(err as Error).message}`);
    }
    return (await this.views([created.review], 'customer'))[0];
  }

  /** Public list for a visible product, with its rating summary. */
  async forProduct(productId: string, q: ProductReviewQueryDto) {
    const [product] = await this.dataSource.query(
      `SELECT p.rating_avg, p.rating_count ${PRODUCT_FROM_SQL} WHERE p.id = $1 AND ${VISIBLE_PRODUCT_SQL}`,
      [productId],
    );
    if (!product) throw notFound('Product');
    const params = new SqlParams();
    const where = [
      `r.product_id = ${params.add(productId)}`,
      'NOT r.is_hidden',
    ];
    if (q.rating) where.push(`r.rating = ${params.add(q.rating)}`);
    if (q.withPhotos === 'true') where.push('cardinality(r.photos) > 0');
    const page = await this.page(where, params, q);
    return {
      ...page,
      summary: {
        ratingAvg: parseFloat(product.rating_avg),
        ratingCount: product.rating_count,
        breakdown: await this.breakdown(productId),
      },
    };
  }

  async partnerList(storeId: string, q: PartnerReviewQueryDto) {
    const params = new SqlParams();
    const where = [`r.store_id = ${params.add(storeId)}`];
    if (q.rating) where.push(`r.rating = ${params.add(q.rating)}`);
    if (q.unreplied === 'true') where.push('r.store_reply IS NULL');
    return this.page(where, params, q, 'store');
  }

  /** Reply once; the reply can be edited for 24 hours after it was first posted. */
  async reply(storeId: string, id: string, dto: ReplyDto) {
    const review = await this.dataSource.manager.findOne(ProductReview, {
      where: { id, storeId },
    });
    if (!review) throw notFound();
    if (
      review.repliedAt &&
      Date.now() - review.repliedAt.getTime() > REPLY_EDIT_WINDOW_MS
    ) {
      throw new ConflictException({
        code: ErrorCode.CONFLICT,
        message: 'Replies can only be edited for 24 hours.',
        details: { repliedAt: review.repliedAt },
      });
    }
    await this.dataSource.manager.update(
      ProductReview,
      { id },
      { storeReply: dto.text, repliedAt: review.repliedAt ?? new Date() },
    );
    const fresh = await this.dataSource.manager.findOneByOrFail(ProductReview, {
      id,
    });
    return (await this.views([fresh], 'store'))[0];
  }

  /** Admin moderation: hide (or restore) a review; ratings follow. */
  async setHidden(id: string, hidden: boolean, reason: string | null) {
    return this.dataSource.transaction(async (m) => {
      const review = await m.findOne(ProductReview, { where: { id } });
      if (!review) throw notFound();
      await this.lockTargets(m, review.productId, review.storeId);
      await m.update(
        ProductReview,
        { id },
        { isHidden: hidden, hiddenReason: hidden ? reason : null },
      );
      await this.recompute(m, review.productId, review.storeId);
      return {
        ...review,
        isHidden: hidden,
        hiddenReason: hidden ? reason : null,
      };
    });
  }

  async breakdown(productId: string): Promise<RatingBreakdown> {
    const rows: Array<{ rating: number; n: number }> =
      await this.dataSource.query(
        `SELECT rating, count(*)::int AS n FROM product_reviews
        WHERE product_id = $1 AND NOT is_hidden GROUP BY rating`,
        [productId],
      );
    const out: RatingBreakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    rows.forEach((r) => (out[r.rating as 1 | 2 | 3 | 4 | 5] = r.n));
    return out;
  }

  /** Which of these order lines this customer has already reviewed. */
  async reviewedLines(lineIds: string[]): Promise<Set<string>> {
    if (!lineIds.length) return new Set();
    const rows = await this.dataSource.query(
      `SELECT store_order_item_id AS id FROM product_reviews WHERE store_order_item_id = ANY($1::uuid[])`,
      [lineIds],
    );
    return new Set(rows.map((r: { id: string }) => r.id));
  }

  // ── plumbing ──────────────────────────────────────────────────────────────

  private exists() {
    return new ConflictException({
      code: ErrorCode.REVIEW_EXISTS,
      message: 'You have already reviewed this item.',
    });
  }

  private async lockTargets(
    m: EntityManager,
    productId: string,
    storeId: string,
  ) {
    await m.query(`SELECT 1 FROM products WHERE id = $1 FOR UPDATE`, [
      productId,
    ]);
    await m.query(`SELECT 1 FROM stores WHERE id = $1 FOR UPDATE`, [storeId]);
  }

  private async recompute(
    m: EntityManager,
    productId: string,
    storeId: string,
  ) {
    await m.query(
      `UPDATE products p SET rating_avg = coalesce(a.avg, 0), rating_count = a.n
         FROM (SELECT round(avg(rating)::numeric, 2) AS avg, count(*)::int AS n
                 FROM product_reviews WHERE product_id = $1 AND NOT is_hidden) a
        WHERE p.id = $1`,
      [productId],
    );
    await m.query(
      `UPDATE stores s SET rating_avg = coalesce(a.avg, 0), rating_count = a.n
         FROM (SELECT round(avg(rating)::numeric, 2) AS avg, count(*)::int AS n
                 FROM product_reviews WHERE store_id = $1 AND NOT is_hidden) a
        WHERE s.id = $1`,
      [storeId],
    );
  }

  private async page(
    where: string[],
    params: SqlParams,
    q: { page: number; pageSize: number },
    audience: 'public' | 'store' = 'public',
  ) {
    const whereSql = where.join(' AND ');
    const [{ total }] = await this.dataSource.query(
      `SELECT count(*)::int AS total FROM product_reviews r WHERE ${whereSql}`,
      params.values,
    );
    const ids: Array<{ id: string }> = await this.dataSource.query(
      `SELECT r.id FROM product_reviews r WHERE ${whereSql}
        ORDER BY r.created_at DESC, r.id
        LIMIT ${params.add(q.pageSize)} OFFSET ${params.add((q.page - 1) * q.pageSize)}`,
      params.values,
    );
    const rows = ids.length
      ? await this.dataSource.manager.find(ProductReview, {
          where: { id: In(ids.map((r) => r.id)) },
        })
      : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    return paged(
      await this.views(
        ids.map((r) => byId.get(r.id)!),
        audience,
      ),
      total,
      q,
    );
  }

  private async views(
    rows: ProductReview[],
    audience: 'public' | 'store' | 'customer',
  ) {
    if (!rows.length) return [];
    const meta: Array<{
      id: string;
      display_name: string | null;
      avatar_url: string | null;
      deleted: boolean;
      variant_label: string;
      product_name: string;
    }> = await this.dataSource.query(
      `SELECT r.id, u.display_name, u.avatar_url, (u.deleted_at IS NOT NULL) AS deleted,
                i.variant_label, i.product_name
           FROM product_reviews r
           JOIN users u ON u.id = r.user_id
           JOIN store_order_items i ON i.id = r.store_order_item_id
          WHERE r.id = ANY($1::uuid[])`,
      [rows.map((r) => r.id)],
    );
    const metaOf = new Map(meta.map((x) => [x.id, x]));
    return rows.map((r) => {
      const x = metaOf.get(r.id)!;
      return {
        id: r.id,
        productId: r.productId,
        ...(audience !== 'public'
          ? { productName: x.product_name, orderItemId: r.storeOrderItemId }
          : {}),
        rating: r.rating,
        text: r.text,
        photos: r.photos,
        variantLabel: x.variant_label,
        author: {
          name: publicName(x.display_name, x.deleted),
          avatarUrl: x.deleted ? null : x.avatar_url,
        },
        storeReply: r.storeReply,
        repliedAt: r.repliedAt,
        ...(audience !== 'public' ? { isHidden: r.isHidden } : {}),
        createdAt: r.createdAt,
      };
    });
  }
}
