import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ErrorCode } from '../../../common/errors/codes';
import { newCode } from '../../../common/utils/codes';
import {
  formatTime12,
  localDate,
  parseTime,
  todayIn,
  wallTimeToInstant,
  weekdayOf,
} from '../../../common/time/time.util';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import type { VendorRef } from '../../food/vendor/food-vendor.service';
import { VISIBLE_VENDOR_SQL } from '../../food/discovery/discovery.service';
import { VendorSettingsService } from '../../food/vendor/vendor-settings.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { MediaService } from '../../media/media.service';
import { SurplusBox } from '../entities/surplus.entity';
import {
  CollectDto,
  DonationDto,
  ReserveDto,
  ReservationsQueryDto,
  SurplusBoxDto,
  SurplusQueryDto,
  UpdateSurplusBoxDto,
} from '../dto/surplus.dto';
import { kitchenNotFound } from '../common/errors';
import { InsightCardsService } from '../insights/insight-cards.service';
import { ForecastService } from '../forecast/forecast.service';

/** Three no-shows → no reservations for this long. */
export const NO_SHOW_LIMIT = 3;
export const BLOCK_DAYS = 14;

const conflict = (
  code: string,
  message: string,
  details?: Record<string, unknown>,
) => new ConflictException({ code, message, ...(details ? { details } : {}) });

const rs = (n: number) => `Rs ${n.toLocaleString('en-PK')}`;

/**
 * Bachat Box: same-day surplus at a discount, pickup only. Reserving
 * decrements `remaining` with one conditional UPDATE (the last box goes to
 * exactly one customer); a no-show counts against the customer; donations
 * and collected boxes make "meals rescued".
 */
@Injectable()
export class SurplusService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly settings: VendorSettingsService,
    private readonly notifications: NotificationsService,
    private readonly media: MediaService,
    private readonly insights: InsightCardsService,
    private readonly forecast: ForecastService,
  ) {}

  onModuleInit(): void {
    this.insights.register(async (v) => {
      const s = await this.suggestion(v);
      return s.draft
        ? [
            {
              kind: 'surplus_suggestion',
              priority: 3,
              title: `About ${s.leftover} portions may be left tonight`,
              body: `Put them in a Bachat Box (${s.draft.quantity} boxes at ${rs(s.draft.price)}) before ${formatTime12(new Date(s.draft.pickupTo), s.tz)}.`,
              action: {
                label: 'Create a Bachat Box',
                screen: 'kitchen.surplus.new',
              },
              data: { draft: s.draft },
            },
          ]
        : [];
    });
  }

  private async tz(m: EntityManager, branchId: string): Promise<string> {
    const [b] = await m.query(`SELECT timezone FROM branches WHERE id = $1`, [
      branchId,
    ]);
    return b.timezone;
  }

  // ── vendor ──
  async create(v: VendorRef, dto: SurplusBoxDto, now = new Date()) {
    const tz = await this.tz(this.dataSource.manager, v.branchId);
    const from = new Date(dto.pickupFrom);
    const to = new Date(dto.pickupTo);
    this.window(from, to, tz, now);
    if (dto.price > dto.originalValue)
      throw this.invalid(
        'price',
        'The box price can’t be more than its menu value.',
      );
    const box = await this.dataSource.manager.save(
      this.dataSource.manager.create(SurplusBox, {
        branchId: v.branchId,
        title: dto.title,
        description: dto.description ?? null,
        contentsHint: dto.contentsHint ?? null,
        originalValue: dto.originalValue,
        price: dto.price,
        quantity: dto.quantity,
        remaining: dto.quantity,
        pickupFrom: from,
        pickupTo: to,
        tags: [...new Set(dto.tags ?? [])],
      }),
    );
    return this.vendorBox(v, box.id);
  }

  async update(
    v: VendorRef,
    id: string,
    dto: UpdateSurplusBoxDto,
    now = new Date(),
  ) {
    await this.dataSource.transaction(async (m) => {
      const [b] = await m.query(
        `SELECT * FROM surplus_boxes WHERE id = $1 AND branch_id = $2 FOR UPDATE`,
        [id, v.branchId],
      );
      if (!b) throw kitchenNotFound('Bachat Box');
      if (!['live', 'sold_out'].includes(b.status))
        throw conflict(
          ErrorCode.INVALID_TRANSITION,
          `This box is ${b.status}.`,
        );
      const reserved = b.quantity - b.remaining;
      const quantity = dto.quantity ?? b.quantity;
      if (quantity < reserved)
        throw this.invalid('quantity', `${reserved} are already reserved.`);
      const price = dto.price ?? b.price;
      if (price > b.original_value)
        throw this.invalid(
          'price',
          'The box price can’t be more than its menu value.',
        );
      if (dto.price !== undefined && reserved > 0 && dto.price !== b.price)
        throw this.invalid(
          'price',
          'The price is fixed once someone has reserved.',
        );
      const to = dto.pickupTo ? new Date(dto.pickupTo) : b.pickup_to;
      if (dto.pickupTo)
        this.window(b.pickup_from, to, await this.tz(m, v.branchId), now);
      const remaining = quantity - reserved;
      await m.query(
        `UPDATE surplus_boxes SET title = $2, description = $3, contents_hint = $4, price = $5, quantity = $6,
                remaining = $7, pickup_to = $8, status = $9, updated_at = now() WHERE id = $1`,
        [
          id,
          dto.title ?? b.title,
          dto.description ?? b.description,
          dto.contentsHint ?? b.contents_hint,
          price,
          quantity,
          remaining,
          to,
          remaining > 0 ? 'live' : 'sold_out',
        ],
      );
    });
    return this.vendorBox(v, id);
  }

  /** Off the shelf; anyone who reserved is told. */
  async cancel(v: VendorRef, id: string) {
    const users = await this.dataSource.transaction(async (m) => {
      const res = await m.query(
        `UPDATE surplus_boxes SET status = 'cancelled', updated_at = now()
          WHERE id = $1 AND branch_id = $2 AND status IN ('live', 'sold_out') RETURNING title`,
        [id, v.branchId],
      );
      const rows = Array.isArray(res[0]) ? res[0] : res;
      if (!rows.length) {
        const [b] = await m.query(
          `SELECT status FROM surplus_boxes WHERE id = $1 AND branch_id = $2`,
          [id, v.branchId],
        );
        if (!b) throw kitchenNotFound('Bachat Box');
        throw conflict(
          ErrorCode.INVALID_TRANSITION,
          `This box is ${b.status}.`,
        );
      }
      const r = await m.query(
        `UPDATE surplus_reservations SET status = 'cancelled', cancelled_at = now(), updated_at = now()
          WHERE box_id = $1 AND status = 'reserved' RETURNING user_id, code`,
        [id],
      );
      return {
        title: rows[0].title as string,
        people: (Array.isArray(r[0]) ? r[0] : r) as Array<{
          user_id: string;
          code: string;
        }>,
      };
    });
    for (const p of users.people)
      await this.safeNotify(p.user_id, {
        type: 'food.surplus.cancelled',
        title: 'Bachat Box cancelled',
        body: `${users.title} was cancelled by the kitchen. Reservation ${p.code} is void.`,
        data: { screen: 'food.surplus.reservations' },
      });
    return this.vendorBox(v, id);
  }

  async list(v: VendorRef, status?: string) {
    const rows = await this.dataSource.query(
      `SELECT id FROM surplus_boxes WHERE branch_id = $1 ${status ? 'AND status = $2' : ''}
        ORDER BY pickup_to DESC LIMIT 100`,
      status ? [v.branchId, status] : [v.branchId],
    );
    const out = [];
    for (const r of rows) out.push(await this.vendorBox(v, r.id));
    return out;
  }

  async vendorBox(v: VendorRef, id: string) {
    const [b] = await this.dataSource.query(
      `SELECT sb.*, (SELECT coalesce(sum(quantity), 0)::int FROM surplus_reservations WHERE box_id = sb.id AND status = 'collected') AS collected,
              (SELECT coalesce(sum(quantity), 0)::int FROM surplus_reservations WHERE box_id = sb.id AND status = 'reserved') AS reserved
         FROM surplus_boxes sb WHERE sb.id = $1 AND sb.branch_id = $2`,
      [id, v.branchId],
    );
    if (!b) throw kitchenNotFound('Bachat Box');
    return { ...this.boxView(b), reserved: b.reserved, collected: b.collected };
  }

  async reservations(v: VendorRef, q: ReservationsQueryDto) {
    const params: unknown[] = [v.branchId];
    const where = ['sb.branch_id = $1'];
    if (q.boxId) {
      params.push(q.boxId);
      where.push(`r.box_id = $${params.length}`);
    }
    if (q.status) {
      params.push(q.status);
      where.push(`r.status = $${params.length}`);
    }
    const rows = await this.dataSource.query(
      `SELECT r.id, r.box_id, sb.title, r.quantity, r.code, r.status, r.payment_method, r.total, r.created_at,
              r.collected_at, u.display_name, u.phone
         FROM surplus_reservations r JOIN surplus_boxes sb ON sb.id = r.box_id JOIN users u ON u.id = r.user_id
        WHERE ${where.join(' AND ')} ORDER BY r.created_at DESC LIMIT 200`,
      params,
    );
    return rows.map((r: any) => ({
      id: r.id,
      boxId: r.box_id,
      title: r.title,
      quantity: r.quantity,
      code: r.code,
      status: r.status,
      paymentMethod: r.payment_method,
      total: r.total,
      reservedAt: r.created_at,
      collectedAt: r.collected_at,
      customer: { name: r.display_name, phone: r.phone },
    }));
  }

  async collected(v: VendorRef, id: string, dto: CollectDto) {
    await this.dataSource.transaction(async (m) => {
      const r = await this.ownReservation(m, v, id);
      if (r.status !== 'reserved')
        throw conflict(
          ErrorCode.INVALID_TRANSITION,
          `This reservation is ${r.status}.`,
        );
      if (dto.code && dto.code.toUpperCase() !== r.code)
        throw this.invalid('code', 'That code doesn’t match this reservation.');
      await m.query(
        `UPDATE surplus_reservations SET status = 'collected', collected_at = now(), updated_at = now() WHERE id = $1`,
        [id],
      );
    });
    return (await this.reservations(v, {})).find(
      (x: { id: string }) => x.id === id,
    );
  }

  /** After the pickup window: the customer never came. Three → blocked for 14 days. */
  async noShow(v: VendorRef, id: string, now = new Date()) {
    const blocked = await this.dataSource.transaction(async (m) => {
      const r = await this.ownReservation(m, v, id);
      if (r.status !== 'reserved')
        throw conflict(
          ErrorCode.INVALID_TRANSITION,
          `This reservation is ${r.status}.`,
        );
      if (new Date(r.pickup_to) > now)
        throw conflict(
          ErrorCode.INVALID_TRANSITION,
          'The pickup window hasn’t closed yet.',
        );
      await m.query(
        `UPDATE surplus_reservations SET status = 'no_show', updated_at = now() WHERE id = $1`,
        [id],
      );
      const [s] = await m.query(
        `INSERT INTO surplus_customer_status (user_id, no_shows) VALUES ($1, 1)
         ON CONFLICT (user_id) DO UPDATE SET no_shows = surplus_customer_status.no_shows + 1, updated_at = now()
         RETURNING no_shows`,
        [r.user_id],
      );
      if (s.no_shows >= NO_SHOW_LIMIT) {
        const until = new Date(now.getTime() + BLOCK_DAYS * 86_400_000);
        await m.query(
          `UPDATE surplus_customer_status SET no_shows = 0, blocked_until = $2, updated_at = now() WHERE user_id = $1`,
          [r.user_id, until],
        );
        return { userId: r.user_id as string, until };
      }
      return null;
    });
    if (blocked)
      await this.safeNotify(blocked.userId, {
        type: 'food.surplus.blocked',
        title: 'Bachat Box reservations paused',
        body: `Three boxes weren’t collected, so you can reserve again from ${blocked.until.toDateString()}.`,
        data: { screen: 'food.surplus' },
      });
    return (await this.reservations(v, {})).find(
      (x: { id: string }) => x.id === id,
    );
  }

  private async ownReservation(m: EntityManager, v: VendorRef, id: string) {
    const [r] = await m.query(
      `SELECT r.*, sb.pickup_to FROM surplus_reservations r JOIN surplus_boxes sb ON sb.id = r.box_id
        WHERE r.id = $1 AND sb.branch_id = $2 FOR UPDATE OF r`,
      [id, v.branchId],
    );
    if (!r) throw kitchenNotFound('Reservation');
    return r;
  }

  /** At closing: today's planned portions not yet sold → a draft box (half the menu value). */
  async suggestion(v: VendorRef, now = new Date()) {
    const tz = await this.tz(this.dataSource.manager, v.branchId);
    const today = todayIn(tz, now);
    const planned = await this.forecast.planned(
      this.dataSource.manager,
      v.branchId,
      today,
    );
    const sold: Array<{ item_id: string; qty: number }> =
      await this.dataSource.query(
        `SELECT oi.item_id, sum(oi.quantity)::int AS qty FROM food_orders o JOIN food_order_items oi ON oi.order_id = o.id
        WHERE o.branch_id = $1 AND o.status NOT IN ('rejected', 'auto_rejected', 'cancelled')
          AND (coalesce(o.scheduled_for, o.created_at) AT TIME ZONE $2)::date = $3::date GROUP BY 1`,
        [v.branchId, tz, today],
      );
    const items: Array<{ id: string; name: string; base_price: number }> =
      planned.size
        ? await this.dataSource.query(
            `SELECT id, name, base_price FROM menu_items WHERE id = ANY($1::uuid[])`,
            [[...planned.keys()]],
          )
        : [];
    const left = items
      .map((i) => ({
        ...i,
        left: Math.max(
          0,
          Math.floor(
            planned.get(i.id)!.planned -
              (sold.find((s) => s.item_id === i.id)?.qty ?? 0),
          ),
        ),
      }))
      .filter((i) => i.left > 0)
      .sort((a, b) => b.left - a.left);
    const leftover = left.reduce((s, i) => s + i.left, 0);
    const [open] = await this.dataSource.query(
      `SELECT opens_at, closes_at FROM branch_hours
        WHERE branch_id = $1 AND weekday = $2 ORDER BY closes_at DESC LIMIT 1`,
      [v.branchId, weekdayOf(today)],
    );
    let closeAt: Date | null = null;
    if (open) {
      const opens = parseTime(String(open.opens_at).slice(0, 5));
      let closes = parseTime(String(open.closes_at).slice(0, 5));
      if (closes <= opens) closes += 1440;
      closeAt = wallTimeToInstant(today, closes, tz);
    }
    const hoursLeft = closeAt
      ? (closeAt.getTime() - now.getTime()) / 3_600_000
      : null;
    // Only in the last two hours before closing, and only for a real surplus.
    if (
      leftover < 2 ||
      hoursLeft === null ||
      hoursLeft > 2 ||
      hoursLeft <= 0.25
    )
      return { tz, leftover, draft: null };
    const quantity = Math.max(1, Math.round(leftover / 2));
    const value = Math.round(
      left.reduce((s, i) => s + i.base_price * i.left, 0) / quantity,
    );
    return {
      tz,
      leftover,
      draft: {
        title: 'Bachat Box — tonight’s surplus',
        contentsHint: `Usually ${left
          .slice(0, 3)
          .map((i) => i.name)
          .join(', ')}`,
        originalValue: value,
        price: Math.round(value / 2 / 10) * 10,
        quantity,
        pickupFrom: now.toISOString(),
        // Same day only: a kitchen open past midnight closes the box at 11:59 PM.
        pickupTo: (localDate(closeAt!, tz) === today
          ? closeAt!
          : wallTimeToInstant(today, 1439, tz)!
        ).toISOString(),
      },
    };
  }

  // ── donations ──
  async donations(v: VendorRef) {
    const rows = await this.dataSource.query(
      `SELECT id, organisation, meals, notes, photo_url, created_at FROM surplus_donations
        WHERE branch_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [v.branchId],
    );
    const [c] = await this.dataSource.query(
      `SELECT (SELECT coalesce(sum(meals), 0)::int FROM surplus_donations WHERE branch_id = $1) AS donated,
              (SELECT coalesce(sum(r.quantity), 0)::int FROM surplus_reservations r JOIN surplus_boxes sb ON sb.id = r.box_id
                WHERE sb.branch_id = $1 AND r.status = 'collected') AS boxes`,
      [v.branchId],
    );
    return {
      mealsRescued: c.donated + c.boxes,
      donatedMeals: c.donated,
      boxesCollected: c.boxes,
      items: rows.map((r: any) => ({
        id: r.id,
        organisation: r.organisation,
        meals: r.meals,
        notes: r.notes,
        photoUrl: r.photo_url,
        at: r.created_at,
      })),
    };
  }

  async donate(v: VendorRef, dto: DonationDto) {
    if (dto.photoUrl)
      this.media.assertOwnedAsset(
        v.ownerUserId,
        'kitchen_story',
        dto.photoUrl,
        undefined,
        'photoUrl',
      );
    await this.dataSource.query(
      `INSERT INTO surplus_donations (branch_id, organisation, meals, notes, photo_url) VALUES ($1, $2, $3, $4, $5)`,
      [
        v.branchId,
        dto.organisation,
        dto.meals,
        dto.notes ?? null,
        dto.photoUrl ?? null,
      ],
    );
    return this.donations(v);
  }

  // ── customers ──
  async nearby(q: SurplusQueryDto, now = new Date()) {
    const radius = (q.radiusKm ?? 8) * 1000;
    const rows = await this.dataSource.query(
      `SELECT sb.*, fb.name AS vendor_name, fb.slug, fb.logo_url, br.address_line, br.area, br.city, br.timezone,
              ST_Distance(br.geo, ST_SetSRID(ST_MakePoint($2::float8, $1::float8), 4326)::geography) AS distance_m
         FROM surplus_boxes sb JOIN branches br ON br.id = sb.branch_id
         JOIN food_brands fb ON fb.id = br.brand_id JOIN businesses b ON b.id = br.business_id
        WHERE ${VISIBLE_VENDOR_SQL} AND NOT br.is_paused AND sb.status = 'live' AND sb.remaining > 0 AND sb.pickup_to > $4
          AND ST_DWithin(br.geo, ST_SetSRID(ST_MakePoint($2::float8, $1::float8), 4326)::geography, $3)
        ORDER BY distance_m, sb.pickup_to LIMIT 50`,
      [q.lat, q.lng, radius, now],
    );
    return rows.map((r: any) => ({
      ...this.boxView(r),
      vendor: {
        name: r.vendor_name,
        slug: r.slug,
        logoUrl: r.logo_url,
        address: [r.address_line, r.area, r.city].filter(Boolean).join(', '),
      },
      distanceKm: Math.round(r.distance_m / 100) / 10,
      pickupLabel: `Pick up ${formatTime12(r.pickup_from, r.timezone)} – ${formatTime12(r.pickup_to, r.timezone)}`,
    }));
  }

  async reserve(
    user: AuthenticatedUser,
    boxId: string,
    dto: ReserveDto,
    now = new Date(),
  ) {
    const out = await this.dataSource.transaction(async (m) => {
      const [status] = await m.query(
        `SELECT blocked_until FROM surplus_customer_status WHERE user_id = $1`,
        [user.id],
      );
      if (status?.blocked_until && new Date(status.blocked_until) > now)
        throw new ForbiddenException({
          code: ErrorCode.SURPLUS_BLOCKED,
          message:
            'Three boxes weren’t collected, so Bachat Box reservations are paused for now.',
          details: { until: status.blocked_until },
        });
      const [box] = await m.query(
        `SELECT sb.*, br.business_id FROM surplus_boxes sb JOIN branches br ON br.id = sb.branch_id
           JOIN food_brands fb ON fb.id = br.brand_id JOIN businesses b ON b.id = br.business_id
          WHERE sb.id = $1 AND ${VISIBLE_VENDOR_SQL}`,
        [boxId],
      );
      if (!box) throw kitchenNotFound('Bachat Box');
      if (
        new Date(box.pickup_to) <= now ||
        box.status === 'expired' ||
        box.status === 'cancelled'
      )
        throw conflict(
          ErrorCode.SURPLUS_WINDOW_CLOSED,
          'The pickup window for this box has closed.',
        );
      const accounts =
        dto.paymentMethod === 'transfer'
          ? await this.settings.activeAccounts(m, box.business_id)
          : [];
      if (dto.paymentMethod === 'transfer' && !accounts.length)
        throw this.invalid(
          'paymentMethod',
          'This kitchen takes payment at pickup only.',
        );
      // The one write that decides who gets the last box.
      const res = await m.query(
        `UPDATE surplus_boxes SET remaining = remaining - $2,
                status = CASE WHEN remaining - $2 = 0 THEN 'sold_out'::surplus_status ELSE status END, updated_at = now()
          WHERE id = $1 AND status = 'live' AND remaining >= $2 AND pickup_to > $3 RETURNING remaining`,
        [boxId, dto.quantity, now],
      );
      if (!(Array.isArray(res[0]) ? res[0] : res).length)
        throw conflict(
          ErrorCode.SURPLUS_SOLD_OUT,
          'Sorry — those boxes have just gone.',
          { remaining: box.remaining },
        );
      let code = '';
      for (let i = 0; i < 5 && !code; i++) {
        const c = newCode('BB');
        const r = await m.query(
          `INSERT INTO surplus_reservations (box_id, user_id, quantity, code, payment_method, total)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (code) DO NOTHING RETURNING id`,
          [
            boxId,
            user.id,
            dto.quantity,
            c,
            dto.paymentMethod ?? 'pay_at_pickup',
            box.price * dto.quantity,
          ],
        );
        if ((Array.isArray(r[0]) ? r[0] : r).length) code = c;
      }
      const [owner] = await m.query(
        `SELECT owner_user_id FROM businesses WHERE id = $1`,
        [box.business_id],
      );
      return {
        code,
        accounts,
        owner: owner.owner_user_id as string,
        title: box.title as string,
        qty: dto.quantity,
      };
    });
    await this.safeNotify(out.owner, {
      type: 'kitchen.surplus.reserved',
      title: `Bachat Box reserved: ${out.qty} × ${out.title}`,
      body: `Code ${out.code}.`,
      data: { screen: 'kitchen.surplus.reservations' },
    });
    const [mine] = (await this.myReservations(user)).filter(
      (r: { code: string }) => r.code === out.code,
    );
    return { ...mine, payTo: out.accounts };
  }

  async myReservations(user: AuthenticatedUser) {
    const rows = await this.dataSource.query(
      `SELECT r.id, r.code, r.quantity, r.status, r.payment_method, r.total, r.created_at, r.collected_at,
              sb.id AS box_id, sb.title, sb.pickup_from, sb.pickup_to, fb.name AS vendor_name, fb.slug,
              br.address_line, br.area, br.city, br.timezone, br.phone
         FROM surplus_reservations r JOIN surplus_boxes sb ON sb.id = r.box_id
         JOIN branches br ON br.id = sb.branch_id JOIN food_brands fb ON fb.id = br.brand_id
        WHERE r.user_id = $1 ORDER BY r.created_at DESC LIMIT 50`,
      [user.id],
    );
    return rows.map((r: any) => ({
      id: r.id,
      code: r.code,
      quantity: r.quantity,
      status: r.status,
      paymentMethod: r.payment_method,
      total: r.total,
      reservedAt: r.created_at,
      collectedAt: r.collected_at,
      box: {
        id: r.box_id,
        title: r.title,
        pickupFrom: r.pickup_from,
        pickupTo: r.pickup_to,
      },
      vendor: {
        name: r.vendor_name,
        slug: r.slug,
        phone: r.phone,
        address: [r.address_line, r.area, r.city].filter(Boolean).join(', '),
      },
      pickupLabel: `${formatTime12(r.pickup_from, r.timezone)} – ${formatTime12(r.pickup_to, r.timezone)}, ${localDate(r.pickup_from, r.timezone)}`,
      canCancel: r.status === 'reserved' && new Date(r.pickup_to) > new Date(),
    }));
  }

  /** Before the window closes: the box goes back on the shelf. */
  async cancelMine(user: AuthenticatedUser, id: string, now = new Date()) {
    await this.dataSource.transaction(async (m) => {
      const [r] = await m.query(
        `SELECT r.*, sb.pickup_to FROM surplus_reservations r JOIN surplus_boxes sb ON sb.id = r.box_id
          WHERE r.id = $1 AND r.user_id = $2 FOR UPDATE OF r`,
        [id, user.id],
      );
      if (!r) throw kitchenNotFound('Reservation');
      if (r.status !== 'reserved')
        throw conflict(
          ErrorCode.INVALID_TRANSITION,
          `This reservation is ${r.status}.`,
        );
      if (new Date(r.pickup_to) <= now)
        throw conflict(
          ErrorCode.SURPLUS_WINDOW_CLOSED,
          'The pickup window has closed.',
        );
      await m.query(
        `UPDATE surplus_reservations SET status = 'cancelled', cancelled_at = now(), updated_at = now() WHERE id = $1`,
        [id],
      );
      await m.query(
        `UPDATE surplus_boxes SET remaining = remaining + $2,
                status = CASE WHEN status = 'sold_out' THEN 'live'::surplus_status ELSE status END, updated_at = now()
          WHERE id = $1 AND status IN ('live', 'sold_out')`,
        [r.box_id, r.quantity],
      );
    });
    return (await this.myReservations(user)).find(
      (x: { id: string }) => x.id === id,
    );
  }

  /** Job: boxes past their window expire (unsold ones), sold-out ones close as they are. */
  async expire(m: EntityManager, now: Date) {
    const res = await m.query(
      `UPDATE surplus_boxes SET status = 'expired', updated_at = now()
        WHERE status = 'live' AND pickup_to <= $1 RETURNING id`,
      [now],
    );
    return (Array.isArray(res[0]) ? res[0] : res).length;
  }

  private boxView(b: any) {
    return {
      id: b.id,
      title: b.title,
      description: b.description,
      contentsHint: b.contents_hint,
      originalValue: b.original_value,
      price: b.price,
      discountPct: b.original_value
        ? Math.round((1 - b.price / b.original_value) * 100)
        : 0,
      quantity: b.quantity,
      remaining: b.remaining,
      pickupFrom: b.pickup_from,
      pickupTo: b.pickup_to,
      tags: b.tags,
      status: b.status,
    };
  }

  private window(from: Date, to: Date, tz: string, now: Date) {
    if (!(to > from))
      throw this.invalid('pickupTo', 'The window must end after it starts.');
    if (to <= now)
      throw this.invalid('pickupTo', 'The window must end in the future.');
    if (
      localDate(from, tz) !== localDate(to, tz) ||
      localDate(to, tz) !== todayIn(tz, now)
    )
      throw this.invalid('pickupTo', 'A Bachat Box is for pickup today.');
  }

  private invalid(field: string, message: string) {
    return new BadRequestException({
      code: ErrorCode.VALIDATION_FAILED,
      message,
      details: { fields: { [field]: [message] } },
    });
  }

  private async safeNotify(
    userId: string,
    payload: Parameters<NotificationsService['notify']>[1],
  ) {
    try {
      await this.notifications.notify(userId, payload);
    } catch {
      /* the reservation stands */
    }
  }
}
