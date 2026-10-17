import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { FoodCart } from './entities/food-cart.entity';
import { FoodCartItem } from './entities/food-cart-item.entity';
import {
  AddCartItemDto,
  PatchCartDto,
  UpdateCartItemDto,
} from './dto/cart.dto';
import { MenuReadService } from '../menu/menu-read.service';
import {
  ItemSnapshot,
  LineError,
  priceChoice,
  unavailableReason,
} from '../menu/item-pricing';
import { VISIBLE_VENDOR_SQL } from '../discovery/discovery.service';
import {
  FoodCheckoutPlanner,
  FoodPlan,
  PlanInput,
  PlanIssue,
} from '../checkout/food-checkout-planner.service';
import { ErrorCode } from '../../../common/errors/codes';
import { localDate, toZonedIso } from '../../../common/time/time.util';

const MAX_QUANTITY = 50;
const MAX_LINES = 40;

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

const lineError = (e: LineError) =>
  new BadRequestException({
    code: e.code,
    message: e.message,
    details: e.details,
  });

/**
 * One cart per customer, one vendor per cart. Lines are validated when
 * added (options, availability, today's portions) and re-priced every time
 * the cart is read — the view is the checkout planner's, so the cart,
 * preview and checkout never disagree.
 */
@Injectable()
export class FoodCartService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly menu: MenuReadService,
    private readonly planner: FoodCheckoutPlanner,
  ) {}

  async view(userId: string, input: PlanInput = {}) {
    const plan = await this.planner.plan(
      this.dataSource.manager,
      userId,
      input,
      {
        defaultAddress: true,
      },
    );
    return cartView(plan);
  }

  async preview(userId: string, input: PlanInput) {
    const plan = await this.planner.plan(
      this.dataSource.manager,
      userId,
      input,
    );
    return previewView(plan);
  }

  async addItem(userId: string, dto: AddCartItemDto, replace: boolean) {
    await this.dataSource.transaction(async (m) => {
      const [vendor] = await m.query(
        `SELECT fb.id AS brand_id, fb.name, br.id AS branch_id, br.timezone, br.accepts_delivery
           FROM food_brands fb JOIN branches br ON br.brand_id = fb.id JOIN businesses b ON b.id = fb.business_id
          WHERE fb.id = $1 AND ${VISIBLE_VENDOR_SQL}`,
        [dto.vendorId],
      );
      if (!vendor)
        throw new NotFoundException({
          code: ErrorCode.NOT_FOUND,
          message: 'This vendor is not on Food Court.',
        });
      const snap = (
        await this.menu.snapshots(vendor.branch_id, [dto.itemId], m)
      ).get(dto.itemId);
      if (!snap)
        throw new NotFoundException({
          code: ErrorCode.NOT_FOUND,
          message: 'Dish not found.',
        });

      await m.query(
        `INSERT INTO food_carts (user_id, brand_id, branch_id, fulfilment)
         VALUES ($1, $2, $3, $4) ON CONFLICT (user_id) DO NOTHING`,
        [
          userId,
          vendor.brand_id,
          vendor.branch_id,
          vendor.accepts_delivery ? 'delivery' : 'pickup',
        ],
      );
      const cart = (await m.findOne(FoodCart, {
        where: { userId },
        lock: { mode: 'pessimistic_write' },
      }))!;
      let lines = await m.find(FoodCartItem, { where: { cartId: cart.id } });
      if (cart.brandId !== vendor.brand_id) {
        if (lines.length && !replace) {
          const [current] = await m.query(
            `SELECT id, name FROM food_brands WHERE id = $1`,
            [cart.brandId],
          );
          throw new ConflictException({
            code: ErrorCode.CART_OTHER_VENDOR,
            message: `Your cart has dishes from ${current.name}. Start a new cart from ${vendor.name}?`,
            details: {
              currentVendor: { id: current.id, name: current.name },
              itemCount: lines.reduce((s, l) => s + l.quantity, 0),
            },
          });
        }
        await m.delete(FoodCartItem, { cartId: cart.id });
        lines = [];
        await m.update(FoodCart, cart.id, {
          brandId: vendor.brand_id,
          branchId: vendor.branch_id,
          fulfilment: vendor.accepts_delivery ? 'delivery' : 'pickup',
          scheduledFor: null,
        });
        cart.scheduledFor = null;
      }

      const unitPrice = this.validate(
        snap,
        vendor.timezone,
        cart.scheduledFor,
        dto,
      );
      const optionIds = [...new Set(dto.optionIds ?? [])];
      const same = lines.find(
        (l) =>
          l.itemId === dto.itemId &&
          (l.variantId ?? null) === (dto.variantId ?? null) &&
          sameSet(l.optionIds, optionIds) &&
          (l.notes ?? null) === (dto.notes ?? null),
      );
      const quantity = (same?.quantity ?? 0) + dto.quantity;
      if (quantity > MAX_QUANTITY)
        throw new BadRequestException({
          code: ErrorCode.VALIDATION_FAILED,
          message: `At most ${MAX_QUANTITY} of one dish per order.`,
          details: { fields: { quantity: [`at most ${MAX_QUANTITY}`] } },
        });
      this.assertPortions(
        snap,
        vendor.timezone,
        cart.scheduledFor,
        lines,
        dto.quantity,
      );
      if (same) {
        await m.update(FoodCartItem, same.id, {
          quantity,
          unitPriceSeen: unitPrice,
        });
      } else {
        if (lines.length >= MAX_LINES)
          throw new BadRequestException({
            code: ErrorCode.VALIDATION_FAILED,
            message: `A cart holds at most ${MAX_LINES} lines.`,
          });
        await m.insert(FoodCartItem, {
          cartId: cart.id,
          itemId: dto.itemId,
          variantId: dto.variantId ?? null,
          optionIds,
          quantity: dto.quantity,
          notes: dto.notes ?? null,
          unitPriceSeen: unitPrice,
        });
      }
      await m.update(FoodCart, cart.id, { updatedAt: new Date() });
    });
    return this.view(userId);
  }

  async updateItem(userId: string, lineId: string, dto: UpdateCartItemDto) {
    await this.dataSource.transaction(async (m) => {
      const { cart, line, lines } = await this.lineOf(m, userId, lineId);
      const [b] = await m.query(`SELECT timezone FROM branches WHERE id = $1`, [
        cart.branchId,
      ]);
      const snap = (
        await this.menu.snapshots(cart.branchId, [line.itemId], m)
      ).get(line.itemId);
      if (!snap)
        throw new NotFoundException({
          code: ErrorCode.NOT_FOUND,
          message:
            'That dish is no longer on the menu — remove it from your cart.',
        });
      const next = {
        vendorId: cart.brandId,
        itemId: line.itemId,
        variantId: dto.variantId !== undefined ? dto.variantId : line.variantId,
        optionIds: dto.optionIds ?? line.optionIds,
        quantity: dto.quantity ?? line.quantity,
        notes: dto.notes !== undefined ? dto.notes : line.notes,
      };
      const unitPrice = this.validate(
        snap,
        b.timezone,
        cart.scheduledFor,
        next,
      );
      this.assertPortions(
        snap,
        b.timezone,
        cart.scheduledFor,
        lines.filter((l) => l.id !== line.id),
        next.quantity,
      );
      await m.update(FoodCartItem, line.id, {
        variantId: next.variantId ?? null,
        optionIds: [...new Set(next.optionIds)],
        quantity: next.quantity,
        notes: next.notes ?? null,
        unitPriceSeen: unitPrice,
      });
    });
    return this.view(userId);
  }

  async removeItem(userId: string, lineId: string) {
    await this.dataSource.transaction(async (m) => {
      const { cart, line, lines } = await this.lineOf(m, userId, lineId);
      if (lines.length === 1) await m.delete(FoodCart, { id: cart.id });
      else await m.delete(FoodCartItem, { id: line.id });
    });
    return this.view(userId);
  }

  /**
   * Rebuild the cart from a past order at today's menu and prices. Lines
   * that can't be ordered any more are left out and reported (QA #23).
   */
  async reorder(userId: string, code: string) {
    const result = await this.dataSource.transaction(async (m) => {
      const [o] = await m.query(
        `SELECT id, brand_id, branch_id, fulfilment FROM food_orders WHERE code = $1 AND user_id = $2`,
        [code, userId],
      );
      if (!o)
        throw new NotFoundException({
          code: ErrorCode.NOT_FOUND,
          message: 'Order not found.',
        });
      const [b] = await m.query(
        `SELECT br.id, br.timezone, br.accepts_delivery, br.accepts_pickup FROM food_brands fb
           JOIN branches br ON br.brand_id = fb.id JOIN businesses b ON b.id = fb.business_id
          WHERE fb.id = $1 AND ${VISIBLE_VENDOR_SQL}`,
        [o.brand_id],
      );
      if (!b)
        throw new NotFoundException({
          code: ErrorCode.NOT_FOUND,
          message: 'This vendor is no longer on Food Court.',
        });
      const items: Array<{
        item_id: string | null;
        variant_id: string | null;
        item_name: string;
        options: Array<{ id: string }>;
        quantity: number;
        unit_price: number;
        notes: string | null;
      }> = await m.query(
        `SELECT item_id, variant_id, item_name, options, quantity, unit_price, notes
           FROM food_order_items WHERE order_id = $1 ORDER BY line_no`,
        [o.id],
      );
      const fulfilment =
        (o.fulfilment === 'delivery' && b.accepts_delivery) ||
        (o.fulfilment === 'pickup' && b.accepts_pickup)
          ? o.fulfilment
          : b.accepts_delivery
            ? 'delivery'
            : 'pickup';
      await m.delete(FoodCart, { userId });
      const [cart] = await m.query(
        `INSERT INTO food_carts (user_id, brand_id, branch_id, fulfilment) VALUES ($1, $2, $3, $4) RETURNING id`,
        [userId, o.brand_id, b.id, fulfilment],
      );
      const snaps = await this.menu.snapshots(
        b.id,
        items.map((i) => i.item_id).filter((x): x is string => !!x),
        m,
      );
      const dropped: Array<{ name: string; reason: string; message: string }> =
        [];
      const priceChanges: Array<{ name: string; was: number; now: number }> =
        [];
      const kept: FoodCartItem[] = [];
      for (const i of items) {
        const snap = i.item_id ? snaps.get(i.item_id) : undefined;
        if (!snap) {
          dropped.push({
            name: i.item_name,
            reason: 'not_on_menu',
            message: `${i.item_name} is no longer on the menu.`,
          });
          continue;
        }
        const dto = {
          variantId: i.variant_id,
          optionIds: i.options.map((x) => x.id),
        };
        let unitPrice: number;
        try {
          unitPrice = this.validate(snap, b.timezone, null, dto);
          this.assertPortions(snap, b.timezone, null, kept, i.quantity);
        } catch (e) {
          const err = (e as HttpException).getResponse?.() as
            { code: string; message: string } | undefined;
          if (!err) throw e;
          dropped.push({
            name: i.item_name,
            reason: err.code,
            message: err.message,
          });
          continue;
        }
        if (unitPrice !== i.unit_price)
          priceChanges.push({
            name: i.item_name,
            was: i.unit_price,
            now: unitPrice,
          });
        const line = m.create(FoodCartItem, {
          cartId: cart.id,
          itemId: snap.id,
          variantId: dto.variantId,
          optionIds: dto.optionIds,
          quantity: i.quantity,
          notes: i.notes,
          unitPriceSeen: unitPrice,
        });
        await m.save(line);
        kept.push(line);
      }
      if (!kept.length) await m.delete(FoodCart, { id: cart.id });
      return { dropped, priceChanges };
    });
    return { cart: await this.view(userId), ...result };
  }

  async clear(userId: string) {
    await this.dataSource.manager.delete(FoodCart, { userId });
    return { cleared: true };
  }

  /** Fulfilment and "when": checked now so the customer hears about a bad choice straight away. */
  async patch(userId: string, dto: PatchCartDto) {
    await this.dataSource.transaction(async (m) => {
      const cart = await m.findOne(FoodCart, {
        where: { userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!cart)
        throw new BadRequestException({
          code: ErrorCode.CART_EMPTY,
          message: 'Your cart is empty.',
        });
      const [b] = await m.query(
        `SELECT accepts_delivery, accepts_pickup FROM branches WHERE id = $1`,
        [cart.branchId],
      );
      if (dto.fulfilment === 'delivery' && !b.accepts_delivery)
        throw new BadRequestException({
          code: ErrorCode.FULFILMENT_UNAVAILABLE,
          message: 'This vendor doesn’t deliver — choose pickup.',
        });
      if (dto.fulfilment === 'pickup' && !b.accepts_pickup)
        throw new BadRequestException({
          code: ErrorCode.FULFILMENT_UNAVAILABLE,
          message: 'This vendor doesn’t offer pickup.',
        });
      const patch: Partial<FoodCart> = {};
      if (dto.fulfilment) patch.fulfilment = dto.fulfilment;
      if (dto.scheduledFor !== undefined)
        patch.scheduledFor = dto.scheduledFor
          ? new Date(dto.scheduledFor)
          : null;
      if (Object.keys(patch).length) await m.update(FoodCart, cart.id, patch);
    });
    const view = await this.view(userId);
    const schedulingIssue = view.issues.find((i) =>
      [ErrorCode.SLOT_INVALID, ErrorCode.SLOT_FULL].includes(i.code as never),
    );
    if (dto.scheduledFor && schedulingIssue) {
      // Don't keep a time that can't be used.
      await this.dataSource.manager.update(
        FoodCart,
        { userId },
        { scheduledFor: null },
      );
      throw new HttpException(
        {
          code: schedulingIssue.code,
          message: schedulingIssue.message,
          details: schedulingIssue.details,
        },
        schedulingIssue.code === ErrorCode.SLOT_FULL ? 409 : 400,
      );
    }
    return view;
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  /** The unit price, or the reason the choice can't be added. */
  private validate(
    snap: ItemSnapshot,
    tz: string,
    scheduledFor: Date | null,
    dto: { variantId?: string | null; optionIds?: string[] },
  ): number {
    const now = new Date();
    const at = scheduledFor ?? now;
    let reason = unavailableReason(snap, tz, at, now);
    if (reason === 'sold_out' && localDate(at, tz) !== localDate(now, tz))
      reason = null;
    if (reason)
      throw new ConflictException({
        code:
          reason === 'sold_out'
            ? ErrorCode.PORTIONS_SOLD_OUT
            : ErrorCode.ITEM_UNAVAILABLE,
        message:
          reason === 'sold_out'
            ? `${snap.name} is sold out today.`
            : `${snap.name} isn’t available ${scheduledFor ? 'at that time' : 'right now'}.`,
        details: {
          item: snap.name,
          itemId: snap.id,
          reason,
          remaining: snap.remainingToday,
        },
      });
    try {
      return priceChoice(snap, {
        variantId: dto.variantId,
        optionIds: dto.optionIds,
      }).unitPrice;
    } catch (e) {
      if (e instanceof LineError) throw lineError(e);
      throw e;
    }
  }

  private assertPortions(
    snap: ItemSnapshot,
    tz: string,
    scheduledFor: Date | null,
    others: FoodCartItem[],
    adding: number,
  ) {
    if (snap.remainingToday === null) return;
    const now = new Date();
    if (scheduledFor && localDate(scheduledFor, tz) !== localDate(now, tz))
      return;
    const inCart = others
      .filter((l) => l.itemId === snap.id)
      .reduce((s, l) => s + l.quantity, 0);
    if (inCart + adding > snap.remainingToday)
      throw new ConflictException({
        code: ErrorCode.PORTIONS_SOLD_OUT,
        message: `Only ${snap.remainingToday} ${snap.name} left today.`,
        details: {
          item: snap.name,
          itemId: snap.id,
          remaining: snap.remainingToday,
        },
      });
  }

  private async lineOf(m: EntityManager, userId: string, lineId: string) {
    const cart = await m.findOne(FoodCart, {
      where: { userId },
      lock: { mode: 'pessimistic_write' },
    });
    const lines = cart
      ? await m.find(FoodCartItem, { where: { cartId: cart.id } })
      : [];
    const line = lines.find((l) => l.id === lineId);
    if (!cart || !line)
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'That line isn’t in your cart.',
      });
    return { cart, line, lines };
  }
}

/** A line as the customer sees it. */
const lineView = (l: FoodPlan['lines'][number]) => ({
  id: l.id,
  itemId: l.itemId,
  name: l.name,
  photoUrl: l.photoUrl,
  variant: l.variant,
  options: l.options.map((o) => ({
    id: o.id,
    name: o.name,
    group: o.group,
    priceDelta: o.priceDelta,
  })),
  quantity: l.quantity,
  unitPrice: l.unitPrice,
  lineTotal: l.lineTotal,
  notes: l.notes,
  priceChanged: l.priceChanged,
  error: l.error,
});

const vendorView = (p: FoodPlan) =>
  p.vendor && p.branch && p.quote
    ? {
        id: p.vendor.id,
        name: p.vendor.name,
        slug: p.vendor.slug,
        logoUrl: p.vendor.logoUrl,
        openState: {
          open: p.quote.open.open,
          paused: p.quote.open.paused,
          label: p.quote.open.label,
        },
        acceptsDelivery: p.branch.accepts_delivery,
        acceptsPickup: p.branch.accepts_pickup,
        preorderOnly: p.branch.preorder_only,
      }
    : null;

const scheduled = (p: FoodPlan) =>
  p.cart?.scheduledFor && p.branch
    ? {
        at: toZonedIso(p.cart.scheduledFor, p.branch.timezone),
        label: p.scheduledLabel,
        slotId: p.slot?.slotId ?? null,
      }
    : null;

/** GET /food/cart: every problem is a warning here; checkout is where they block. */
export function cartView(p: FoodPlan) {
  if (!p.cart)
    return {
      empty: true,
      vendor: null,
      fulfilment: null,
      scheduledFor: null,
      lines: [] as Array<ReturnType<typeof lineView>>,
      itemCount: 0,
      subtotal: 0,
      warnings: [] as PlanIssue[],
      issues: [] as PlanIssue[],
    };
  return {
    empty: false,
    vendor: vendorView(p),
    fulfilment: p.cart.fulfilment,
    scheduledFor: scheduled(p),
    lines: p.lines.map(lineView),
    itemCount: p.lines.reduce((s, l) => s + l.quantity, 0),
    subtotal: p.subtotal,
    warnings: [...p.issues, ...p.warnings].filter(
      (i) => i.code !== ErrorCode.ADDRESS_LOCATION_REQUIRED,
    ),
    issues: p.issues,
  };
}

/** POST /food/cart/preview: totals exactly as checkout would charge them. */
export function previewView(p: FoodPlan) {
  const q = p.quote;
  return {
    ok: p.ok,
    issues: p.issues,
    warnings: p.warnings,
    vendor: vendorView(p),
    fulfilment: p.cart?.fulfilment ?? null,
    scheduledFor: scheduled(p),
    lines: p.lines.map(lineView),
    totals: {
      subtotal: p.subtotal,
      discount: p.discount,
      deliveryFee: p.deliveryFee,
      total: p.total,
    },
    deal: p.promotion
      ? {
          id: p.promotion.id,
          title: p.promotion.title,
          kind: p.promotion.kind,
          code: p.promotion.code,
          discount: p.promotion.discount,
        }
      : null,
    minOrder: p.minOrder,
    shortfall: p.shortfall,
    freeDeliveryOver: q?.freeDeliveryOver ?? null,
    distanceKm: q?.distanceKm ?? null,
    eta:
      q && !p.cart?.scheduledFor
        ? { min: q.eta.min, max: q.eta.max, label: q.etaLabel }
        : null,
    payment: {
      method: p.paymentMethod,
      available: p.paymentMethods,
      codLimit: p.branch?.cod_limit ?? null,
      accounts: p.paymentMethods.transfer ? p.accounts : [],
    },
  };
}
