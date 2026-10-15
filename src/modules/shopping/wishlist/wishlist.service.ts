import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { WishlistItem } from './entities/wishlist-item.entity';
import { ErrorCode } from '../../../common/errors/codes';
import {
  paged,
  PaginationQueryDto,
} from '../../../common/pagination/pagination';
import { AccountService } from '../../auth/account.service';
import { PRODUCT_FROM_SQL, VISIBLE_PRODUCT_SQL } from '../common/catalog-sql';
import { PRODUCT_CARD_COLUMNS, productCard } from '../catalog/product-card';

export const MAX_WISHLIST = 500;

@Injectable()
export class WishlistService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly account: AccountService,
  ) {}

  onModuleInit(): void {
    this.account.onAccountDeleted(async (m, user) => {
      await m.delete(WishlistItem, { userId: user.id });
    });
  }

  /**
   * Saved products, newest first. Products that have since gone (paused
   * store, unpublished, removed) stay listed with `available: false` so the
   * customer understands where they went.
   */
  async list(userId: string, q: PaginationQueryDto) {
    const [{ total }] = await this.dataSource.query(
      `SELECT count(*)::int AS total FROM wishlist_items w
         JOIN products p ON p.id = w.product_id
        WHERE w.user_id = $1 AND p.status <> 'removed'`,
      [userId],
    );
    const rows = await this.dataSource.query(
      `SELECT ${PRODUCT_CARD_COLUMNS}, (${VISIBLE_PRODUCT_SQL}) AS available, w.created_at AS saved_at
         ${PRODUCT_FROM_SQL}
         JOIN wishlist_items w ON w.product_id = p.id
        WHERE w.user_id = $1 AND p.status <> 'removed'
        ORDER BY w.created_at DESC, w.id
        LIMIT $2 OFFSET $3`,
      [userId, q.pageSize, (q.page - 1) * q.pageSize],
    );
    return paged(
      rows.map((r: any) => ({
        ...productCard(r),
        isWishlisted: true,
        available: r.available,
        savedAt: r.saved_at,
      })),
      total,
      q,
    );
  }

  async add(userId: string, productId: string) {
    const [visible] = await this.dataSource.query(
      `SELECT 1 ${PRODUCT_FROM_SQL} WHERE p.id = $1 AND ${VISIBLE_PRODUCT_SQL}`,
      [productId],
    );
    if (!visible) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Product not found.',
      });
    }
    const count = await this.dataSource.manager.count(WishlistItem, {
      where: { userId },
    });
    if (count >= MAX_WISHLIST) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `Your wishlist holds up to ${MAX_WISHLIST} products.`,
      });
    }
    await this.dataSource
      .createQueryBuilder()
      .insert()
      .into(WishlistItem)
      .values({ userId, productId })
      .orIgnore()
      .execute();
    return { productId, isWishlisted: true };
  }

  /** Idempotent: removing what isn't there is fine. */
  async remove(userId: string, productId: string) {
    await this.dataSource.manager.delete(WishlistItem, { userId, productId });
    return { productId, isWishlisted: false };
  }

  /** Which of these products this customer has saved. */
  async idsIn(userId: string, productIds: string[]): Promise<Set<string>> {
    if (!productIds.length) return new Set();
    const rows = await this.dataSource.manager.find(WishlistItem, {
      where: { userId, productId: In(productIds) },
      select: { productId: true },
    });
    return new Set(rows.map((r) => r.productId));
  }
}
