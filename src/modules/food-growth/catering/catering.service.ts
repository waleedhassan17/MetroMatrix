import { pgDate } from '../../../common/db/parallel';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ErrorCode } from '../../../common/errors/codes';
import { newCode } from '../../../common/utils/codes';
import {
  parseTime,
  todayIn,
  wallTimeToInstant,
} from '../../../common/time/time.util';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import type { VendorRef } from '../../food/vendor/food-vendor.service';
import { VISIBLE_VENDOR_SQL } from '../../food/discovery/discovery.service';
import { FoodOrderWriter } from '../../food/orders/food-order-writer.service';
import {
  FoodOrderTransitionsService,
  SYSTEM,
} from '../../food/orders/food-order-transitions.service';
import { FoodNotifier } from '../../food/orders/food-notifier.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { MediaService } from '../../media/media.service';
import { ForecastService } from '../../kitchen/forecast/forecast.service';
import { kitchenNotFound } from '../../kitchen/common/errors';
import {
  AcceptQuoteDto,
  AdvanceProofDto,
  CateringQueryDto,
  CateringRequestDto,
  QuoteDto,
} from './dto/catering.dto';

/** A quote is valid this long unless the vendor says otherwise. */
export const QUOTE_VALID_DAYS = 3;

const conflict = (
  code: string,
  message: string,
  details?: Record<string, unknown>,
) => new ConflictException({ code, message, ...(details ? { details } : {}) });
const invalid = (field: string, message: string) =>
  new BadRequestException({
    code: ErrorCode.VALIDATION_FAILED,
    message,
    details: { fields: { [field]: [message] } },
  });
const transition = (from: string, to: string) =>
  conflict(
    ErrorCode.INVALID_TRANSITION,
    `This booking is ${from.replace('_', ' ')}; it can't be ${to} now.`,
    { from, to },
  );

const rs = (n: number) => `Rs ${n.toLocaleString('en-PK')}`;
const iso = pgDate;

/**
 * Dawat and catering bookings. Request → the vendor quotes (each change is a
 * new version, until one is accepted) → the customer accepts the newest
 * unexpired version (an older one is refused; an expired one is
 * CATERING_QUOTE_EXPIRED) → the advance goes straight to the vendor, with
 * proof → the vendor confirms → on the event day one scheduled order is
 * written from the quote (source `catering`, `prepaid_amount` = advance).
 * Zero commission: MetroMatrix holds nothing.
 */
@Injectable()
export class CateringService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly writer: FoodOrderWriter,
    private readonly transitions: FoodOrderTransitionsService,
    private readonly notifier: FoodNotifier,
    private readonly notifications: NotificationsService,
    private readonly media: MediaService,
    private readonly forecast: ForecastService,
  ) {}

  onModuleInit(): void {
    this.transitions.afterStatus.push(async (m, order, _from, to) => {
      if (order.source !== 'catering') return;
      if (to === 'delivered' || to === 'picked_up')
        await m.query(
          `UPDATE catering_requests SET status = 'completed', updated_at = now() WHERE food_order_id = $1`,
          [order.id],
        );
    });
    // Accepted bookings' menu lines are certain demand on their day.
    this.forecast.extraDemand.push((m, branchId, date) =>
      this.demand(m, branchId, date),
    );
  }

  // ── customers ──
  async request(
    user: AuthenticatedUser,
    dto: CateringRequestDto,
    now = new Date(),
  ) {
    const out = await this.dataSource.transaction(async (m) => {
      const [v] = await m.query(
        `SELECT fb.id, fb.name, br.timezone, b.owner_user_id FROM food_brands fb
           JOIN branches br ON br.brand_id = fb.id JOIN businesses b ON b.id = fb.business_id
          WHERE fb.id = $1 AND ${VISIBLE_VENDOR_SQL}`,
        [dto.vendorId],
      );
      if (!v) throw kitchenNotFound('Vendor');
      if (dto.eventDate <= todayIn(v.timezone, now))
        throw invalid('eventDate', 'Book at least a day ahead.');
      const menuIds = dto.requestedItems
        .map((i) => i.menuItemId)
        .filter(Boolean) as string[];
      if (menuIds.length) {
        const [{ n }] = await m.query(
          `SELECT count(*)::int AS n FROM menu_items WHERE brand_id = $1 AND id = ANY($2::uuid[])`,
          [v.id, [...new Set(menuIds)]],
        );
        if (n !== new Set(menuIds).size) throw kitchenNotFound('Item');
      }
      let address = null;
      if (dto.fulfilment !== 'pickup') {
        if (!dto.addressId)
          throw invalid('addressId', 'Choose the venue address.');
        const [a] = await m.query(
          `SELECT * FROM addresses WHERE id = $1 AND user_id = $2`,
          [dto.addressId, user.id],
        );
        if (!a) throw kitchenNotFound('Address');
        if (a.lat === null || a.lng === null)
          throw invalid('addressId', 'Drop a pin on the map for this address.');
        address = {
          label: a.label,
          fullName: a.full_name,
          phone: a.phone,
          city: a.city,
          area: a.area,
          line1: a.line1,
          landmark: a.landmark,
          building: null,
          floor: null,
          riderInstructions:
            dto.fulfilment === 'on_site' ? 'On-site catering' : null,
          lat: Number(a.lat),
          lng: Number(a.lng),
        };
      }
      let id: string | null = null;
      let code = '';
      for (let i = 0; i < 5 && !id; i++) {
        code = newCode('CT');
        const [row] = await m.query(
          `INSERT INTO catering_requests (code, user_id, brand_id, event_date, event_time, guests, event_type, requested_items,
                  budget, fulfilment, address_snapshot, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT (code) DO NOTHING RETURNING id`,
          [
            code,
            user.id,
            v.id,
            dto.eventDate,
            dto.eventTime,
            dto.guests,
            dto.eventType,
            JSON.stringify(
              dto.requestedItems.map((r) => ({
                menuItemId: r.menuItemId ?? null,
                name: r.name,
                qty: r.qty ?? null,
              })),
            ),
            dto.budget ?? null,
            dto.fulfilment,
            address ? JSON.stringify(address) : null,
            dto.notes ?? null,
          ],
        );
        if (row) id = row.id;
      }
      return {
        id: id!,
        code,
        owner: v.owner_user_id as string,
        guests: dto.guests,
        date: dto.eventDate,
      };
    });
    await this.tell(
      out.owner,
      'kitchen.catering.requested',
      `Catering request ${out.code}`,
      `${out.guests} guests on ${out.date}. Send a quote.`,
    );
    return this.customerView(user, out.id);
  }

  async mine(user: AuthenticatedUser) {
    const rows = await this.dataSource.query(
      `SELECT id FROM catering_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [user.id],
    );
    const out = [];
    for (const r of rows) out.push(await this.customerView(user, r.id));
    return out;
  }

  async customerView(user: AuthenticatedUser, id: string) {
    const [r] = await this.dataSource.query(
      `SELECT cr.*, fb.name AS vendor_name, fb.slug FROM catering_requests cr JOIN food_brands fb ON fb.id = cr.brand_id
        WHERE cr.id = $1 AND cr.user_id = $2`,
      [id, user.id],
    );
    if (!r) throw kitchenNotFound('Catering request');
    return {
      ...(await this.view(this.dataSource.manager, r)),
      vendor: { name: r.vendor_name, slug: r.slug },
    };
  }

  async accept(
    user: AuthenticatedUser,
    id: string,
    dto: AcceptQuoteDto,
    now = new Date(),
  ) {
    const out = await this.dataSource.transaction(async (m) => {
      const r = await this.lockMine(m, user, id);
      if (r.status !== 'quoted') throw transition(r.status, 'accepted');
      const [latest] = await m.query(
        `SELECT version, valid_until, total, advance_pct FROM catering_quotes WHERE request_id = $1 ORDER BY version DESC LIMIT 1`,
        [id],
      );
      if (dto.version !== latest.version)
        throw conflict(
          ErrorCode.INVALID_TRANSITION,
          `Quote v${dto.version} has been replaced — see v${latest.version}.`,
          {
            version: dto.version,
            latestVersion: latest.version,
          },
        );
      if (new Date(latest.valid_until) <= now)
        throw conflict(
          ErrorCode.CATERING_QUOTE_EXPIRED,
          'This quote has expired — ask the kitchen for a new one.',
          {
            validUntil: latest.valid_until,
          },
        );
      await m.query(
        `UPDATE catering_requests SET status = $2, accepted_version = $3, updated_at = now() WHERE id = $1`,
        [
          id,
          latest.advance_pct === 0 ? 'confirmed' : 'accepted',
          latest.version,
        ],
      );
      const [o] = await m.query(
        `SELECT b.owner_user_id FROM food_brands fb JOIN businesses b ON b.id = fb.business_id WHERE fb.id = $1`,
        [r.brand_id],
      );
      return {
        owner: o.owner_user_id as string,
        code: r.code as string,
        total: latest.total as number,
        noAdvance: latest.advance_pct === 0,
      };
    });
    await this.tell(
      out.owner,
      'kitchen.catering.accepted',
      `Quote accepted: ${out.code}`,
      out.noAdvance
        ? `${rs(out.total)}, no advance — it's booked.`
        : `${rs(out.total)}. The advance proof comes next.`,
    );
    return this.customerView(user, id);
  }

  async advanceProof(
    user: AuthenticatedUser,
    id: string,
    dto: AdvanceProofDto,
  ) {
    this.media.assertOwnedAsset(
      user.id,
      'payment_proof',
      dto.proofUrl,
      dto.publicId,
      'proofUrl',
    );
    const out = await this.dataSource.transaction(async (m) => {
      const r = await this.lockMine(m, user, id);
      if (r.status !== 'accepted')
        throw transition(r.status, 'paid in advance');
      await m.query(
        `UPDATE catering_requests SET status = 'advance_proof', advance_proof_url = $2, advance_ref = $3, updated_at = now() WHERE id = $1`,
        [id, dto.proofUrl, dto.ref ?? null],
      );
      const [o] = await m.query(
        `SELECT b.owner_user_id FROM food_brands fb JOIN businesses b ON b.id = fb.business_id WHERE fb.id = $1`,
        [r.brand_id],
      );
      return { owner: o.owner_user_id as string, code: r.code as string };
    });
    await this.tell(
      out.owner,
      'kitchen.catering.advance',
      `Advance sent: ${out.code}`,
      'Check your account, then confirm the booking.',
    );
    return this.customerView(user, id);
  }

  async cancel(user: AuthenticatedUser, id: string, reason: string) {
    await this.dataSource.transaction(async (m) => {
      const r = await this.lockMine(m, user, id);
      if (
        !['requested', 'quoted', 'accepted', 'advance_proof'].includes(r.status)
      )
        throw transition(r.status, 'cancelled — call the kitchen');
      await m.query(
        `UPDATE catering_requests SET status = 'cancelled', reason = $2, updated_at = now() WHERE id = $1`,
        [id, reason],
      );
    });
    return this.customerView(user, id);
  }

  // ── vendors ──
  async list(v: VendorRef, q: CateringQueryDto) {
    const rows = await this.dataSource.query(
      `SELECT cr.*, u.display_name, u.phone AS user_phone FROM catering_requests cr JOIN users u ON u.id = cr.user_id
        WHERE cr.brand_id = $1 ${q.status ? 'AND cr.status = $2' : ''} ORDER BY cr.event_date, cr.created_at LIMIT 200`,
      q.status ? [v.brandId, q.status] : [v.brandId],
    );
    const out = [];
    for (const r of rows)
      out.push({
        ...(await this.view(this.dataSource.manager, r)),
        customer: {
          name: r.display_name,
          phone: r.address_snapshot?.phone ?? r.user_phone,
        },
      });
    return out;
  }

  async vendorView(v: VendorRef, id: string) {
    const [r] = await this.dataSource.query(
      `SELECT cr.*, u.display_name, u.phone AS user_phone FROM catering_requests cr JOIN users u ON u.id = cr.user_id
        WHERE cr.id = $1 AND cr.brand_id = $2`,
      [id, v.brandId],
    );
    if (!r) throw kitchenNotFound('Catering request');
    return {
      ...(await this.view(this.dataSource.manager, r)),
      customer: {
        name: r.display_name,
        phone: r.address_snapshot?.phone ?? r.user_phone,
      },
      advanceProofDownload: r.advance_proof_url
        ? this.media.privateDownload(r.advance_proof_url)
        : null,
    };
  }

  /** A new version; earlier ones can no longer be accepted. */
  async quote(v: VendorRef, id: string, dto: QuoteDto, now = new Date()) {
    const out = await this.dataSource.transaction(async (m) => {
      const r = await this.lockOwn(m, v, id);
      if (!['requested', 'quoted'].includes(r.status))
        throw transition(r.status, 're-quoted');
      const ids = dto.lines
        .map((l) => l.menuItemId)
        .filter(Boolean) as string[];
      if (ids.length) {
        const [{ n }] = await m.query(
          `SELECT count(*)::int AS n FROM menu_items WHERE brand_id = $1 AND id = ANY($2::uuid[])`,
          [v.brandId, [...new Set(ids)]],
        );
        if (n !== new Set(ids).size) throw kitchenNotFound('Item');
      }
      const [b] = await m.query(`SELECT timezone FROM branches WHERE id = $1`, [
        v.branchId,
      ]);
      const eventAt = wallTimeToInstant(
        iso(r.event_date)!,
        parseTime(String(r.event_time).slice(0, 5)),
        b.timezone,
      )!;
      const validUntil = dto.validUntil
        ? new Date(dto.validUntil)
        : new Date(
            Math.min(
              now.getTime() + QUOTE_VALID_DAYS * 86_400_000,
              eventAt.getTime(),
            ),
          );
      if (validUntil <= now || validUntil > eventAt)
        throw invalid(
          'validUntil',
          'Valid until a time between now and the event.',
        );
      const fee = r.fulfilment === 'pickup' ? 0 : (dto.deliveryFee ?? 0);
      const total =
        dto.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0) + fee;
      const [{ next }] = await m.query(
        `SELECT coalesce(max(version), 0) + 1 AS next FROM catering_quotes WHERE request_id = $1`,
        [id],
      );
      await m.query(
        `INSERT INTO catering_quotes (request_id, lines, delivery_fee, total, advance_pct, valid_until, notes, version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          JSON.stringify(
            dto.lines.map((l) => ({
              menuItemId: l.menuItemId ?? null,
              name: l.name,
              qty: l.qty,
              unitPrice: l.unitPrice,
            })),
          ),
          fee,
          total,
          dto.advancePct,
          validUntil,
          dto.notes ?? null,
          next,
        ],
      );
      await m.query(
        `UPDATE catering_requests SET status = 'quoted', updated_at = now() WHERE id = $1`,
        [id],
      );
      return {
        user: r.user_id as string,
        code: r.code as string,
        version: next as number,
        total,
      };
    });
    await this.tell(
      out.user,
      'food.catering.quoted',
      `Quote for ${out.code} (v${out.version})`,
      `${rs(out.total)} — review and accept it in the app.`,
    );
    return this.vendorView(v, id);
  }

  async decline(v: VendorRef, id: string, reason: string) {
    const r = await this.dataSource.transaction(async (m) => {
      const r = await this.lockOwn(m, v, id);
      if (
        !['requested', 'quoted', 'accepted', 'advance_proof'].includes(r.status)
      )
        throw transition(r.status, 'declined');
      await m.query(
        `UPDATE catering_requests SET status = 'declined', reason = $2, updated_at = now() WHERE id = $1`,
        [id, reason],
      );
      return r;
    });
    await this.tell(
      r.user_id,
      'food.catering.declined',
      `${r.code} declined`,
      reason,
    );
    return this.vendorView(v, id);
  }

  async confirmAdvance(v: VendorRef, id: string) {
    const r = await this.dataSource.transaction(async (m) => {
      const r = await this.lockOwn(m, v, id);
      if (r.status !== 'advance_proof') throw transition(r.status, 'confirmed');
      await m.query(
        `UPDATE catering_requests SET status = 'confirmed', updated_at = now() WHERE id = $1`,
        [id],
      );
      return r;
    });
    await this.tell(
      r.user_id,
      'food.catering.confirmed',
      `${r.code} confirmed`,
      `Your booking for ${iso(r.event_date)} is confirmed.`,
    );
    return this.vendorView(v, id);
  }

  async rejectAdvance(v: VendorRef, id: string, reason: string) {
    const r = await this.dataSource.transaction(async (m) => {
      const r = await this.lockOwn(m, v, id);
      if (r.status !== 'advance_proof')
        throw transition(r.status, 'sent back for the advance');
      await m.query(
        `UPDATE catering_requests SET status = 'accepted', reason = $2, advance_proof_url = NULL, updated_at = now() WHERE id = $1`,
        [id, reason],
      );
      return r;
    });
    await this.tell(
      r.user_id,
      'food.catering.advance_rejected',
      `${r.code}: advance not received`,
      reason,
    );
    return this.vendorView(v, id);
  }

  // ── jobs ──
  /**
   * The event day (branch time): each confirmed booking gets its scheduled
   * order, written once — the request row is locked and the order id set in
   * the same transaction.
   */
  async eventDayOrders(m: EntityManager, now: Date) {
    const due: Array<any> = await m.query(
      `SELECT cr.*, br.id AS branch_id, br.timezone FROM catering_requests cr
         JOIN branches br ON br.brand_id = cr.brand_id
        WHERE cr.status = 'confirmed' AND cr.food_order_id IS NULL
          AND cr.event_date <= ($1::timestamptz AT TIME ZONE br.timezone)::date
        ORDER BY cr.event_date FOR UPDATE OF cr SKIP LOCKED`,
      [now],
    );
    const orders: string[] = [];
    for (const r of due) {
      const [q] = await m.query(
        `SELECT * FROM catering_quotes WHERE request_id = $1 AND version = $2`,
        [r.id, r.accepted_version],
      );
      const at = wallTimeToInstant(
        iso(r.event_date)!,
        parseTime(String(r.event_time).slice(0, 5)),
        r.timezone,
      )!;
      const subtotal = q.total - q.delivery_fee;
      const order = await this.writer.write(
        m,
        {
          userId: r.user_id,
          brandId: r.brand_id,
          branchId: r.branch_id,
          fulfilment: r.fulfilment === 'pickup' ? 'pickup' : 'delivery',
          scheduledFor: at,
          paymentMethod: 'catering',
          paymentStatus: 'cod_pending',
          prepaidAmount: Math.round((q.total * q.advance_pct) / 100),
          addressSnapshot: r.address_snapshot,
          subtotal,
          discount: 0,
          deliveryFee: q.delivery_fee,
          total: q.total,
          source: 'catering',
          customerNote:
            `Catering ${r.code} · ${r.guests} guests${r.fulfilment === 'on_site' ? ' · on site' : ''}${r.notes ? ` · ${r.notes}` : ''}`.slice(
              0,
              500,
            ),
          etaMinutes: null,
          promisedAt: at,
          acceptBy: new Date(now.getTime() + 10 * 60_000),
        },
        (
          q.lines as Array<{
            menuItemId: string | null;
            name: string;
            qty: number;
            unitPrice: number;
          }>
        ).map((l) => ({
          itemId: l.menuItemId,
          variantId: null,
          itemName: l.name,
          variantName: null,
          options: [],
          unitPrice: l.unitPrice,
          quantity: l.qty,
        })),
        SYSTEM,
        { cateringRequestId: r.id, code: r.code },
      );
      await this.transitions.moveStatus(m, order, 'accepted', SYSTEM, {
        note: `Catering ${r.code}`,
      });
      await m.query(
        `UPDATE catering_requests SET food_order_id = $2, updated_at = now() WHERE id = $1`,
        [r.id, order.id],
      );
      orders.push(order.id);
    }
    return orders;
  }

  /** Quotes nobody answered expire; requests whose day passed without a booking expire. */
  async expire(m: EntityManager, now: Date) {
    const quoted = await m.query(
      `UPDATE catering_requests cr SET status = 'expired', updated_at = now()
        WHERE cr.status = 'quoted'
          AND (SELECT max(valid_until) FROM catering_quotes q WHERE q.request_id = cr.id) <= $1
        RETURNING id, user_id, code`,
      [now],
    );
    const stale = await m.query(
      `UPDATE catering_requests cr SET status = 'expired', updated_at = now()
         FROM branches br
        WHERE br.brand_id = cr.brand_id AND cr.status IN ('requested', 'accepted', 'advance_proof')
          AND cr.event_date < ($1::timestamptz AT TIME ZONE br.timezone)::date
        RETURNING cr.id`,
      [now],
    );
    const rows = (Array.isArray(quoted[0]) ? quoted[0] : quoted) as Array<{
      user_id: string;
      code: string;
    }>;
    return {
      quotes: rows,
      stale: (Array.isArray(stale[0]) ? stale[0] : stale).length,
    };
  }

  async announce(
    orders: string[],
    expired: Array<{ user_id: string; code: string }>,
  ) {
    for (const id of orders) await this.notifier.changed(id, 'new');
    for (const e of expired)
      await this.tell(
        e.user_id,
        'food.catering.expired',
        `${e.code}: the quote expired`,
        'Ask the kitchen for a new quote.',
      );
  }

  private async demand(
    m: EntityManager,
    branchId: string,
    date: string,
  ): Promise<Map<string, number>> {
    const rows: Array<{
      lines: Array<{ menuItemId: string | null; qty: number }>;
    }> = await m.query(
      `SELECT q.lines FROM catering_requests cr JOIN branches br ON br.brand_id = cr.brand_id AND br.id = $1
         JOIN catering_quotes q ON q.request_id = cr.id AND q.version = cr.accepted_version
        WHERE cr.status IN ('accepted', 'advance_proof', 'confirmed') AND cr.event_date = $2::date`,
      [branchId, date],
    );
    const out = new Map<string, number>();
    for (const r of rows)
      for (const l of r.lines)
        if (l.menuItemId)
          out.set(l.menuItemId, (out.get(l.menuItemId) ?? 0) + l.qty);
    return out;
  }

  private async view(m: EntityManager, r: any) {
    const quotes = await m.query(
      `SELECT * FROM catering_quotes WHERE request_id = $1 ORDER BY version DESC`,
      [r.id],
    );
    const latest = quotes[0];
    const accepted = quotes.find((q: any) => q.version === r.accepted_version);
    const chosen = accepted ?? latest;
    return {
      id: r.id,
      code: r.code,
      status: r.status,
      eventDate: iso(r.event_date),
      eventTime: String(r.event_time).slice(0, 5),
      guests: r.guests,
      eventType: r.event_type,
      requestedItems: r.requested_items,
      budget: r.budget,
      fulfilment: r.fulfilment,
      address: r.address_snapshot,
      notes: r.notes,
      reason: r.reason,
      quote: latest
        ? {
            version: latest.version,
            lines: latest.lines,
            deliveryFee: latest.delivery_fee,
            total: latest.total,
            advancePct: latest.advance_pct,
            advance: Math.round((latest.total * latest.advance_pct) / 100),
            validUntil: latest.valid_until,
            notes: latest.notes,
          }
        : null,
      versions: quotes.map((q: any) => ({
        version: q.version,
        total: q.total,
        validUntil: q.valid_until,
      })),
      acceptedVersion: r.accepted_version,
      advance: chosen
        ? Math.round((chosen.total * chosen.advance_pct) / 100)
        : null,
      hasAdvanceProof: !!r.advance_proof_url,
      foodOrderId: r.food_order_id,
    };
  }

  private async lockMine(
    m: EntityManager,
    user: AuthenticatedUser,
    id: string,
  ) {
    const [r] = await m.query(
      `SELECT * FROM catering_requests WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [id, user.id],
    );
    if (!r) throw kitchenNotFound('Catering request');
    return r;
  }

  private async lockOwn(m: EntityManager, v: VendorRef, id: string) {
    const [r] = await m.query(
      `SELECT * FROM catering_requests WHERE id = $1 AND brand_id = $2 FOR UPDATE`,
      [id, v.brandId],
    );
    if (!r) throw kitchenNotFound('Catering request');
    return r;
  }

  private async tell(
    userId: string,
    type: string,
    title: string,
    body: string,
  ) {
    try {
      await this.notifications.notify(userId, {
        type,
        title,
        body,
        data: {
          screen: type.startsWith('kitchen')
            ? 'kitchen.catering'
            : 'food.catering',
        },
      });
    } catch {
      /* the change stands */
    }
  }
}
