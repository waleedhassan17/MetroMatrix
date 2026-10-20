import { Injectable, Logger } from '@nestjs/common';
import { DateTime } from 'luxon';
import { DataSource, EntityManager, In } from 'typeorm';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { returned } from '../../common/db/parallel';
import { paged } from '../../common/pagination/pagination';
import { DEFAULT_TZ, addDays } from '../../common/time/time.util';
import { kitchenNotFound } from '../kitchen/common/errors';
import { NotificationsService } from '../notifications/notifications.service';
import { PantryItem } from './entities/pantry-item.entity';
import {
  FromOrdersDto,
  PantryItemDto,
  PantryQueryDto,
  UpdatePantryItemDto,
} from './dto/my-kitchen.dto';
import { EXPIRING_DAYS } from './recipe-library';

export interface PantryDraft {
  storeOrderItemId: string;
  storeOrderId: string;
  orderCode: string;
  name: string;
  qty: number;
  unit: string;
  suggestedExpiresOn: string | null;
}

const today = (now = new Date()) =>
  DateTime.fromJSDate(now, { zone: DEFAULT_TZ }).toISODate()!;

/** Shelf life a grocery category suggests for "add to pantry" (days). */
const SHELF_DAYS: Record<string, number> = {
  'grocery-meat-poultry': 2,
  'grocery-dairy-eggs': 5,
  'grocery-vegetables-fruit': 5,
  'grocery-bakery': 3,
  'grocery-sauces': 90,
  'grocery-rice-flour': 180,
  'grocery-pulses': 180,
};

/**
 * My Kitchen's pantry (Chunk 5, P11): what the customer has at home, with
 * expiry reminders (2 days before and on the day; expired the day after),
 * "used vs expired" stats, and drafts from delivered grocery orders. Every
 * query is scoped by the user: another customer's item is 404.
 */
@Injectable()
export class PantryService {
  private readonly logger = new Logger(PantryService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
  ) {}

  /** The kitchen's canonical name for what people call it (tamatar → tomato). */
  async canonicalOf(m: EntityManager, name: string): Promise<string | null> {
    const [r] = await m.query(
      `SELECT canonical FROM ingredient_aliases WHERE alias = $1 OR lower(alias) = lower($1) LIMIT 1`,
      [name.trim()],
    );
    return r?.canonical ?? null;
  }

  view(p: PantryItem, now = new Date()) {
    const t = today(now);
    const daysLeft = p.expiresOn
      ? Math.round(
          (Date.parse(`${p.expiresOn}T00:00:00Z`) -
            Date.parse(`${t}T00:00:00Z`)) /
            86_400_000,
        )
      : null;
    return {
      id: p.id,
      name: p.name,
      canonical: p.canonical,
      qty: p.qty,
      unit: p.unit,
      expiresOn: p.expiresOn,
      daysLeft,
      expiring:
        p.status === 'active' && daysLeft !== null && daysLeft <= EXPIRING_DAYS,
      status: p.status,
      source: p.source,
      notes: p.notes,
      createdAt: p.createdAt,
      closedAt: p.closedAt,
    };
  }

  private async own(user: AuthenticatedUser, id: string) {
    const p = await this.dataSource
      .getRepository(PantryItem)
      .findOne({ where: { id, userId: user.id } });
    if (!p) throw kitchenNotFound('Pantry item');
    return p;
  }

  async list(user: AuthenticatedUser, q: PantryQueryDto) {
    const [rows, total] = await this.dataSource
      .getRepository(PantryItem)
      .createQueryBuilder('p')
      .where('p.user_id = :u AND p.status = :s', {
        u: user.id,
        s: q.status ?? 'active',
      })
      .orderBy('p.expiresOn', 'ASC', 'NULLS LAST')
      .addOrderBy('p.name', 'ASC')
      .skip((q.page - 1) * q.pageSize)
      .take(q.pageSize)
      .getManyAndCount();
    return paged(
      rows.map((r) => this.view(r)),
      total,
      q,
    );
  }

  async add(
    user: AuthenticatedUser,
    dto: PantryItemDto,
    source: 'manual' | 'voice' = 'manual',
  ) {
    const repo = this.dataSource.getRepository(PantryItem);
    const p = await repo.save(
      repo.create({
        userId: user.id,
        name: dto.name,
        canonical: await this.canonicalOf(this.dataSource.manager, dto.name),
        qty: dto.qty,
        unit: dto.unit,
        expiresOn: dto.expiresOn ?? null,
        notes: dto.notes ?? null,
        source,
      }),
    );
    return this.view(p);
  }

  async addBatch(user: AuthenticatedUser, items: PantryItemDto[]) {
    const out = [];
    for (const i of items) out.push(await this.add(user, i, 'voice'));
    return { items: out };
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdatePantryItemDto) {
    const p = await this.own(user, id);
    if (dto.name !== undefined) {
      p.name = dto.name;
      p.canonical = await this.canonicalOf(this.dataSource.manager, dto.name);
    }
    if (dto.qty !== undefined) p.qty = dto.qty;
    if (dto.unit !== undefined) p.unit = dto.unit;
    if (dto.expiresOn !== undefined) {
      p.expiresOn = dto.expiresOn;
      p.reminded = 0;
    }
    if (dto.notes !== undefined) p.notes = dto.notes;
    await this.dataSource.getRepository(PantryItem).save(p);
    return this.view(p);
  }

  /** Used up, or thrown away: kept for the stats. */
  async close(
    user: AuthenticatedUser,
    id: string,
    status: 'used' | 'discarded',
  ) {
    const p = await this.own(user, id);
    p.status = status;
    p.closedAt = new Date();
    await this.dataSource.getRepository(PantryItem).save(p);
    return this.view(p);
  }

  async remove(user: AuthenticatedUser, id: string) {
    const p = await this.own(user, id);
    await this.dataSource.getRepository(PantryItem).delete({ id: p.id });
    return { removed: true };
  }

  /** Active items expiring within EXPIRING_DAYS (or already past), soonest first. */
  async expiring(user: AuthenticatedUser, now = new Date()) {
    const rows = await this.dataSource
      .getRepository(PantryItem)
      .createQueryBuilder('p')
      .where(
        `p.user_id = :u AND p.status = 'active' AND p.expires_on <= :until`,
        {
          u: user.id,
          until: addDays(today(now), EXPIRING_DAYS),
        },
      )
      .orderBy('p.expiresOn', 'ASC')
      .getMany();
    return { days: EXPIRING_DAYS, items: rows.map((r) => this.view(r, now)) };
  }

  /** Used vs expired vs thrown away, over the last `days`. */
  async stats(user: AuthenticatedUser, days: number, now = new Date()) {
    const since = new Date(now.getTime() - days * 86_400_000);
    const rows: Array<{ status: string; n: number }> =
      await this.dataSource.query(
        `SELECT status, count(*)::int AS n FROM pantry_items
        WHERE user_id = $1 AND status <> 'active' AND closed_at >= $2 GROUP BY status`,
        [user.id, since],
      );
    const wasted = await this.dataSource.query(
      `SELECT name, count(*)::int AS n FROM pantry_items
        WHERE user_id = $1 AND status IN ('expired', 'discarded') AND closed_at >= $2
        GROUP BY name ORDER BY n DESC, name LIMIT 5`,
      [user.id, since],
    );
    const n = (s: string) => rows.find((r) => r.status === s)?.n ?? 0;
    const used = n('used');
    const expired = n('expired');
    const discarded = n('discarded');
    const closed = used + expired + discarded;
    return {
      days,
      used,
      expired,
      discarded,
      /** Share of what left the pantry that was eaten. */
      usedShare: closed ? Math.round((used / closed) * 100) / 100 : null,
      mostWasted: wasted,
    };
  }

  /** Lines of delivered grocery orders (30 days) not yet in the pantry: "add to pantry" drafts. */
  async drafts(
    user: AuthenticatedUser,
    now = new Date(),
  ): Promise<{ items: PantryDraft[] }> {
    const rows = await this.dataSource.query(
      `SELECT soi.id, soi.product_name, soi.variant_label, soi.quantity, so.id AS store_order_id, so.code,
              coalesce(v.pack_qty, p.pack_qty) AS pack_qty, coalesce(v.pack_unit, p.pack_unit) AS pack_unit,
              c.slug AS category
         FROM store_order_items soi JOIN store_orders so ON so.id = soi.store_order_id
         JOIN products p ON p.id = soi.product_id JOIN product_variants v ON v.id = soi.variant_id
         JOIN shop_categories c ON c.id = p.category_id LEFT JOIN shop_categories root ON root.id = c.parent_id
        WHERE so.user_id = $1 AND so.status IN ('delivered', 'completed') AND so.updated_at >= $2
          AND (c.slug = 'grocery' OR root.slug = 'grocery')
          AND NOT EXISTS (SELECT 1 FROM pantry_items pi WHERE pi.store_order_item_id = soi.id)
        ORDER BY so.updated_at DESC, soi.line_no`,
      [user.id, new Date(now.getTime() - 30 * 86_400_000)],
    );
    const t = today(now);
    return {
      items: rows.map((r: any): PantryDraft => {
        const pack = r.pack_qty !== null && r.pack_unit;
        const shelf = SHELF_DAYS[r.category];
        return {
          storeOrderItemId: r.id,
          storeOrderId: r.store_order_id,
          orderCode: r.code,
          name: r.product_name,
          qty: pack ? Number(r.pack_qty) * r.quantity : r.quantity,
          unit: pack ? r.pack_unit : 'pack',
          suggestedExpiresOn: shelf ? addDays(t, shelf) : null,
        };
      }),
    };
  }

  /** Add delivered grocery lines to the pantry (once each). */
  async addFromOrders(
    user: AuthenticatedUser,
    dto: FromOrdersDto,
    now = new Date(),
  ) {
    const drafts = new Map(
      (await this.drafts(user, now)).items.map((d) => [d.storeOrderItemId, d]),
    );
    const added = [];
    for (const l of dto.lines) {
      const d = drafts.get(l.storeOrderItemId);
      if (!d) {
        // Added before: nothing to do. Anything else isn't this person's delivered grocery line.
        const [had] = await this.dataSource.query(
          `SELECT 1 FROM pantry_items WHERE store_order_item_id = $1 AND user_id = $2`,
          [l.storeOrderItemId, user.id],
        );
        if (had) continue;
        throw kitchenNotFound('Order line');
      }
      const res = await this.dataSource.query(
        `INSERT INTO pantry_items (user_id, name, canonical, qty, unit, expires_on, source, store_order_item_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'order', $7)
         ON CONFLICT (store_order_item_id) WHERE store_order_item_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [
          user.id,
          d.name.slice(0, 80),
          await this.canonicalOf(this.dataSource.manager, d.name),
          d.qty,
          d.unit,
          l.expiresOn !== undefined ? l.expiresOn : d.suggestedExpiresOn,
          l.storeOrderItemId,
        ],
      );
      if (res.length) added.push(res[0].id);
    }
    const rows = added.length
      ? await this.dataSource
          .getRepository(PantryItem)
          .findBy({ id: In(added) })
      : [];
    return { added: rows.map((r) => this.view(r, now)) };
  }

  /**
   * The daily reminder run (idempotent: `reminded` bits): "use soon" 2 days
   * before, "expires today" on the day, one notification per person; items
   * past their date become `expired`.
   */
  async remind(m: EntityManager, now = new Date()) {
    const t = today(now);
    const expired = returned(
      await m.query(
        `UPDATE pantry_items SET status = 'expired', closed_at = $2, updated_at = now()
          WHERE status = 'active' AND expires_on < $1::date RETURNING id`,
        [t, now],
      ),
    ).length;
    const due: Array<{
      id: string;
      user_id: string;
      name: string;
      bit: number;
    }> = await m.query(
      `SELECT id, user_id, name, CASE WHEN expires_on = $1::date THEN 2 ELSE 1 END AS bit
         FROM pantry_items
        WHERE status = 'active' AND (
              (expires_on = $1::date AND reminded & 2 = 0) OR (expires_on = $2::date AND reminded & 1 = 0))
        ORDER BY user_id, expires_on, name FOR UPDATE SKIP LOCKED`,
      [t, addDays(t, 2)],
    );
    const byUser = new Map<string, typeof due>();
    for (const d of due)
      byUser.set(d.user_id, [...(byUser.get(d.user_id) ?? []), d]);
    for (const d of due)
      await m.query(
        `UPDATE pantry_items SET reminded = reminded | $2, updated_at = now() WHERE id = $1`,
        [d.id, d.bit],
      );
    const notices = [...byUser.entries()].map(([userId, items]) => {
      const todayItems = items.filter((i) => i.bit === 2).map((i) => i.name);
      const soon = items.filter((i) => i.bit === 1).map((i) => i.name);
      return {
        userId,
        title: todayItems.length
          ? `Use today: ${todayItems.slice(0, 3).join(', ')}`
          : `Use soon: ${soon.slice(0, 3).join(', ')}`,
        body: [
          todayItems.length ? `Expires today: ${todayItems.join(', ')}.` : '',
          soon.length ? `In 2 days: ${soon.join(', ')}.` : '',
          'See recipes that use them in My Kitchen.',
        ]
          .filter(Boolean)
          .join(' '),
      };
    });
    return { expired, reminded: due.length, people: byUser.size, notices };
  }

  async send(notices: Array<{ userId: string; title: string; body: string }>) {
    for (const n of notices)
      try {
        await this.notifications.notify(n.userId, {
          type: 'my_kitchen.expiring',
          title: n.title,
          body: n.body,
          data: { screen: 'my_kitchen.pantry' },
        });
      } catch (err) {
        this.logger.warn(`reminder not sent: ${(err as Error).message}`);
      }
  }
}
