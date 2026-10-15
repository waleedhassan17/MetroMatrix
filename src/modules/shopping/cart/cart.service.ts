import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Cart } from './entities/cart.entity';
import { CartItem, MAX_LINE_QUANTITY } from './entities/cart-item.entity';
import { CartLine, groupByStore, loadCartLines } from './cart-lines';
import { AddCartItemDto, UpdateCartItemDto } from './dto/cart.dto';
import { ErrorCode } from '../../../common/errors/codes';
import { AccountService } from '../../auth/account.service';
import { LOW_STOCK_THRESHOLD, unitPrice } from '../common/catalog-sql';
import { shippingFee } from '../checkout/pricing';

/** Distinct lines a cart may hold. */
export const MAX_CART_LINES = 50;

export interface CartAdjustment {
  variantId: string;
  requested: number;
  quantity: number;
  reason: 'stock' | 'max_per_line';
}

const lineWarnings = (l: CartLine) => {
  const w: Array<{
    code: string;
    message: string;
    details?: Record<string, unknown>;
  }> = [];
  if (!l.isAvailable) {
    w.push({
      code: 'PRODUCT_UNAVAILABLE',
      message: 'No longer sold — remove it to check out.',
    });
  } else if (l.stock === 0) {
    w.push({
      code: ErrorCode.OUT_OF_STOCK,
      message: 'Out of stock — remove it to check out.',
    });
  } else if (l.stock < l.quantity) {
    w.push({
      code: 'LOW_STOCK',
      message: `Only ${l.stock} left — lower the quantity to check out.`,
      details: { available: l.stock },
    });
  }
  if (l.unitPrice !== l.priceAtAdd) {
    w.push({
      code: ErrorCode.PRICE_CHANGED,
      message: `Price changed from Rs ${l.priceAtAdd} to Rs ${l.unitPrice}.`,
      details: { was: l.priceAtAdd, now: l.unitPrice },
    });
  }
  return w;
};

/**
 * The customer's cart. Every write locks the cart row first (the same lock
 * checkout takes), so cart edits and checkout never interleave.
 */
@Injectable()
export class CartService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly account: AccountService,
  ) {}

  onModuleInit(): void {
    // Deleting an account empties its cart (items cascade).
    this.account.onAccountDeleted(async (m, user) => {
      await m.delete(Cart, { userId: user.id });
    });
  }

  /** Get-or-create the customer's cart and hold its row lock for this transaction. */
  async lockCart(m: EntityManager, userId: string): Promise<string> {
    await m.query(
      `INSERT INTO carts (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
      [userId],
    );
    const [row] = await m.query(
      `SELECT id FROM carts WHERE user_id = $1 FOR UPDATE`,
      [userId],
    );
    return row.id;
  }

  async cartIdOf(m: EntityManager, userId: string): Promise<string | null> {
    const [row] = await m.query(`SELECT id FROM carts WHERE user_id = $1`, [
      userId,
    ]);
    return row?.id ?? null;
  }

  async view(userId: string, m: EntityManager = this.dataSource.manager) {
    const cartId = await this.cartIdOf(m, userId);
    const lines = cartId ? await loadCartLines(m, cartId) : [];
    const stores = groupByStore(lines).map(({ store, lines: storeLines }) => {
      // Totals count what could be bought now; the warnings explain the rest.
      const buyable = storeLines.filter(
        (l) => store.isOpen && l.isAvailable && l.stock > 0,
      );
      const subtotal = buyable.reduce(
        (n, l) => n + l.unitPrice * l.quantity,
        0,
      );
      const fee = buyable.length
        ? shippingFee(
            {
              shippingFlatFee: store.shippingFlatFee,
              freeShippingOver: store.freeShippingOver,
            },
            subtotal,
          )
        : 0;
      return {
        store: {
          id: store.id,
          slug: store.slug,
          name: store.name,
          logoUrl: store.logoUrl,
        },
        isAvailable: store.isOpen,
        warnings: store.isOpen
          ? []
          : [
              {
                code: ErrorCode.STORE_UNAVAILABLE,
                message:
                  store.pauseMessage ||
                  `${store.name} isn't taking orders right now.`,
              },
            ],
        items: storeLines.map((l) => ({
          id: l.cartItemId,
          variantId: l.variantId,
          productId: l.productId,
          productName: l.productName,
          variantLabel: l.variantLabel,
          imageUrl: l.imageUrl,
          unitPrice: l.unitPrice,
          priceAtAdd: l.priceAtAdd,
          quantity: l.quantity,
          lineTotal: l.unitPrice * l.quantity,
          inStock: l.isAvailable && l.stock > 0,
          lowStock:
            l.isAvailable && l.stock > 0 && l.stock <= LOW_STOCK_THRESHOLD,
          maxQuantity: Math.min(MAX_LINE_QUANTITY, l.isAvailable ? l.stock : 0),
          warnings: lineWarnings(l),
        })),
        subtotal,
        shippingFee: fee,
        total: subtotal + fee,
        freeShippingOver: store.freeShippingOver,
        amountToFreeShipping:
          store.freeShippingOver !== null
            ? Math.max(0, store.freeShippingOver - subtotal)
            : null,
      };
    });
    const sum = (k: 'subtotal' | 'shippingFee' | 'total') =>
      stores.reduce((n, s) => n + s[k], 0);
    return {
      stores,
      lineCount: lines.length,
      itemCount: lines.reduce((n, l) => n + l.quantity, 0),
      itemsTotal: sum('subtotal'),
      shippingTotal: sum('shippingFee'),
      grandTotal: sum('total'),
      hasWarnings: stores.some(
        (s) => s.warnings.length || s.items.some((i) => i.warnings.length),
      ),
    };
  }

  /** Add a variant; the same variant merges into its line. Quantity is capped at stock. */
  async addItem(userId: string, dto: AddCartItemDto) {
    const adjusted = await this.dataSource.transaction(async (m) => {
      const cartId = await this.lockCart(m, userId);
      const [v] = await m.query(
        `SELECT v.id, v.stock, v.is_active, v.price_delta, p.status, p.base_price, p.sale_price,
                (s.is_paused = false AND b.status = 'approved') AS store_open
           FROM product_variants v
           JOIN products p ON p.id = v.product_id
           JOIN stores s ON s.id = p.store_id
           JOIN businesses b ON b.id = s.business_id
          WHERE v.id = $1`,
        [dto.variantId],
      );
      if (!v || v.status !== 'active' || !v.is_active) {
        throw new NotFoundException({
          code: ErrorCode.NOT_FOUND,
          message: 'Product not found.',
        });
      }
      if (!v.store_open) {
        throw new ConflictException({
          code: ErrorCode.STORE_UNAVAILABLE,
          message: "This store isn't taking orders right now.",
        });
      }
      if (v.stock < 1) {
        throw new ConflictException({
          code: ErrorCode.OUT_OF_STOCK,
          message: 'This option is out of stock.',
          details: {
            lines: [{ variantId: v.id, requested: dto.quantity, available: 0 }],
          },
        });
      }
      const price = unitPrice(
        { basePrice: v.base_price, salePrice: v.sale_price },
        { priceDelta: v.price_delta },
      );
      const existing = await m.findOne(CartItem, {
        where: { cartId, variantId: v.id },
      });
      if (!existing) {
        const lines = await m.count(CartItem, { where: { cartId } });
        if (lines >= MAX_CART_LINES) {
          throw new BadRequestException({
            code: ErrorCode.VALIDATION_FAILED,
            message: `A cart holds at most ${MAX_CART_LINES} different items.`,
          });
        }
      }
      const requested = (existing?.quantity ?? 0) + dto.quantity;
      const cap = Math.min(MAX_LINE_QUANTITY, v.stock);
      const quantity = Math.min(requested, cap);
      // Adding again means the customer has seen today's price.
      if (existing) {
        await m.update(
          CartItem,
          { id: existing.id },
          { quantity, priceAtAdd: price },
        );
      } else {
        await m.insert(CartItem, {
          cartId,
          variantId: v.id,
          quantity,
          priceAtAdd: price,
        });
      }
      await m.update(Cart, { id: cartId }, { updatedAt: new Date() });
      return quantity < requested
        ? ({
            variantId: v.id,
            requested,
            quantity,
            reason: v.stock < MAX_LINE_QUANTITY ? 'stock' : 'max_per_line',
          } satisfies CartAdjustment)
        : null;
    });
    return { ...(await this.view(userId)), adjusted };
  }

  /**
   * Set a line's quantity (capped at stock while any is left). Editing a line
   * also accepts its current price, clearing PRICE_CHANGED.
   */
  async updateItem(userId: string, itemId: string, dto: UpdateCartItemDto) {
    const adjusted = await this.dataSource.transaction(async (m) => {
      const cartId = await this.lockCart(m, userId);
      const [line] = await loadCartLines(m, cartId).then((ls) =>
        ls.filter((l) => l.cartItemId === itemId),
      );
      if (!line) {
        throw new NotFoundException({
          code: ErrorCode.NOT_FOUND,
          message: 'Cart item not found.',
        });
      }
      const quantity =
        line.isAvailable && line.stock > 0
          ? Math.min(dto.quantity, line.stock)
          : dto.quantity;
      await m.update(
        CartItem,
        { id: itemId },
        { quantity, priceAtAdd: line.unitPrice },
      );
      return quantity < dto.quantity
        ? ({
            variantId: line.variantId,
            requested: dto.quantity,
            quantity,
            reason: 'stock',
          } satisfies CartAdjustment)
        : null;
    });
    return { ...(await this.view(userId)), adjusted };
  }

  async removeItem(userId: string, itemId: string) {
    await this.dataSource.transaction(async (m) => {
      const cartId = await this.lockCart(m, userId);
      const res = await m.delete(CartItem, { id: itemId, cartId });
      if (!res.affected) {
        throw new NotFoundException({
          code: ErrorCode.NOT_FOUND,
          message: 'Cart item not found.',
        });
      }
    });
    return { ...(await this.view(userId)), adjusted: null };
  }

  async clear(userId: string) {
    await this.dataSource.transaction(async (m) => {
      const cartId = await this.lockCart(m, userId);
      await m.delete(CartItem, { cartId });
    });
    return { ...(await this.view(userId)), adjusted: null };
  }

  /** This customer's subtotal at one store (live prices), for coupon hints. */
  async storeSubtotal(userId: string, storeId: string): Promise<number> {
    const m = this.dataSource.manager;
    const cartId = await this.cartIdOf(m, userId);
    if (!cartId) return 0;
    const lines = await loadCartLines(m, cartId);
    return lines
      .filter((l) => l.store.id === storeId && l.isAvailable)
      .reduce((n, l) => n + l.unitPrice * l.quantity, 0);
  }
}
