import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { MenuItem } from './entities/menu-item.entity';
import { PreorderSlot } from './entities/preorder-slot.entity';
import {
  AvailabilityPatchDto,
  PreorderSlotDto,
  TodayPatchDto,
  WeeklyMenuEntryDto,
} from './dto/menu.dto';
import { daysOf, maskOf, onDay } from './item-pricing';
import type { VendorRef } from '../vendor/food-vendor.service';
import { VendorSetupService } from '../vendor/vendor-setup.service';
import { ErrorCode } from '../../../common/errors/codes';
import {
  addDays,
  localDate,
  parseTime,
  todayIn,
  wallTimeToInstant,
  weekdayOf,
} from '../../../common/time/time.util';

const notFound = (what: string) =>
  new NotFoundException({
    code: ErrorCode.NOT_FOUND,
    message: `${what} not found.`,
  });

/**
 * What the kitchen can serve right now: items and options switched off
 * ("86'd", optionally until a time), and for home kitchens today's portions,
 * pre-order slots and the weekly menu. Branch-level, never a price change.
 */
@Injectable()
export class MenuAvailabilityService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly setup: VendorSetupService,
  ) {}

  onModuleInit(): void {
    const preorderOnly = (branchId: string) =>
      this.dataSource
        .query(`SELECT preorder_only FROM branches WHERE id = $1`, [branchId])
        .then((r) => !!r[0]?.preorder_only);
    this.setup.register({
      key: 'portions',
      label: 'Today’s portions for at least one dish',
      subTypes: ['home_kitchen'],
      applies: async (_m, v) => !(await preorderOnly(v.branchId)),
      done: async (m, v) =>
        !!(
          await m.query(
            `SELECT 1 FROM branch_item_overrides WHERE branch_id = $1 AND daily_limit IS NOT NULL LIMIT 1`,
            [v.branchId],
          )
        )[0],
    });
    this.setup.register({
      key: 'slots',
      label: 'Pre-order slots',
      subTypes: ['home_kitchen'],
      applies: async (_m, v) => preorderOnly(v.branchId),
      done: async (m, v) =>
        !!(
          await m.query(
            `SELECT 1 FROM preorder_slots WHERE branch_id = $1 LIMIT 1`,
            [v.branchId],
          )
        )[0],
    });
  }

  private async assertItems(v: VendorRef, ids: string[]) {
    if (!ids.length) return;
    const n = await this.dataSource.manager.count(MenuItem, {
      where: { id: In(ids), brandId: v.brandId },
    });
    if (n !== new Set(ids).size) throw notFound('Item');
  }

  async availability(v: VendorRef, now = new Date()) {
    const items = await this.dataSource.query(
      `SELECT i.id, i.name, c.name AS category, coalesce(o.is_available, true) AS is_available, o.unavailable_until,
              o.daily_limit, o.remaining_today
         FROM menu_items i JOIN menu_categories c ON c.id = i.category_id
         LEFT JOIN branch_item_overrides o ON o.item_id = i.id AND o.branch_id = $2
        WHERE i.brand_id = $1 ORDER BY c.sort, i.sort, i.name`,
      [v.brandId, v.branchId],
    );
    const options = await this.dataSource.query(
      `SELECT op.id, op.name, g.name AS group_name, coalesce(bo.is_available, true) AS is_available
         FROM options op JOIN option_groups g ON g.id = op.group_id
         LEFT JOIN branch_option_overrides bo ON bo.option_id = op.id AND bo.branch_id = $2
        WHERE g.brand_id = $1 ORDER BY g.name, op.sort`,
      [v.brandId, v.branchId],
    );
    return {
      items: items.map((r: any) => {
        const until = r.unavailable_until
          ? new Date(r.unavailable_until)
          : null;
        return {
          itemId: r.id,
          name: r.name,
          category: r.category,
          isAvailable: r.is_available && !(until && until > now),
          unavailableUntil: until && until > now ? until : null,
          dailyLimit: r.daily_limit,
          remainingToday: r.remaining_today,
        };
      }),
      options: options.map((r: any) => ({
        optionId: r.id,
        name: r.name,
        group: r.group_name,
        isAvailable: r.is_available,
      })),
    };
  }

  /** Bulk on/off for items (optionally until a time) and options. */
  async patch(v: VendorRef, dto: AvailabilityPatchDto) {
    const items = dto.items ?? [];
    const options = dto.options ?? [];
    await this.assertItems(
      v,
      items.map((i) => i.itemId),
    );
    if (options.length) {
      const [{ n }] = await this.dataSource.query(
        `SELECT count(*)::int AS n FROM options op JOIN option_groups g ON g.id = op.group_id
          WHERE g.brand_id = $1 AND op.id = ANY($2::uuid[])`,
        [v.brandId, options.map((o) => o.optionId)],
      );
      if (n !== new Set(options.map((o) => o.optionId)).size)
        throw notFound('Option');
    }
    await this.dataSource.transaction(async (m) => {
      for (const i of items) {
        const until = i.isAvailable ? null : (i.unavailableUntil ?? null);
        await m.query(
          `INSERT INTO branch_item_overrides (branch_id, item_id, is_available, unavailable_until)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (branch_id, item_id) DO UPDATE SET is_available = EXCLUDED.is_available,
             unavailable_until = EXCLUDED.unavailable_until, updated_at = now()`,
          // Off "until" a time: available after it, so store is_available = true with the until.
          [v.branchId, i.itemId, i.isAvailable || !!until, until],
        );
      }
      for (const o of options) {
        await m.query(
          `INSERT INTO branch_option_overrides (branch_id, option_id, is_available) VALUES ($1, $2, $3)
           ON CONFLICT (branch_id, option_id) DO UPDATE SET is_available = EXCLUDED.is_available, updated_at = now()`,
          [v.branchId, o.optionId, o.isAvailable],
        );
      }
    });
    return this.availability(v);
  }

  // ── Home kitchens ────────────────────────────────────────────────────────

  /** Today: which dishes are cooking (weekly menu) and their portions left. */
  async today(v: VendorRef, now = new Date()) {
    const [{ timezone }] = await this.dataSource.query(
      `SELECT timezone FROM branches WHERE id = $1`,
      [v.branchId],
    );
    const date = todayIn(timezone, now);
    const weekday = weekdayOf(date);
    const rows = await this.dataSource.query(
      `SELECT i.id, i.name, i.days_mask, i.is_active, coalesce(o.is_available, true) AS is_available,
              o.daily_limit, o.remaining_today
         FROM menu_items i LEFT JOIN branch_item_overrides o ON o.item_id = i.id AND o.branch_id = $2
        WHERE i.brand_id = $1 ORDER BY i.sort, i.name`,
      [v.brandId, v.branchId],
    );
    return {
      date,
      weekday,
      items: rows.map((r: any) => ({
        itemId: r.id,
        name: r.name,
        onTodaysMenu: onDay(r.days_mask, weekday),
        cooking: r.is_active && r.is_available && onDay(r.days_mask, weekday),
        dailyLimit: r.daily_limit,
        remainingToday: r.remaining_today,
        sold:
          r.daily_limit !== null && r.remaining_today !== null
            ? r.daily_limit - r.remaining_today
            : null,
      })),
    };
  }

  /**
   * Set today's portions (resets what's left to the number cooked) and
   * switch dishes on/off for today. Portions are the daily limit the nightly
   * reset restores.
   */
  async patchToday(v: VendorRef, dto: TodayPatchDto) {
    await this.assertItems(
      v,
      dto.items.map((i) => i.itemId),
    );
    await this.dataSource.transaction(async (m) => {
      for (const i of dto.items) {
        if (i.portions !== undefined) {
          await m.query(
            `INSERT INTO branch_item_overrides (branch_id, item_id, daily_limit, remaining_today)
             VALUES ($1, $2, $3, $3)
             ON CONFLICT (branch_id, item_id) DO UPDATE SET daily_limit = EXCLUDED.daily_limit,
               remaining_today = EXCLUDED.remaining_today, updated_at = now()`,
            [v.branchId, i.itemId, i.portions],
          );
        }
        if (i.cooking !== undefined) {
          await m.query(
            `INSERT INTO branch_item_overrides (branch_id, item_id, is_available) VALUES ($1, $2, $3)
             ON CONFLICT (branch_id, item_id) DO UPDATE SET is_available = EXCLUDED.is_available,
               unavailable_until = NULL, updated_at = now()`,
            [v.branchId, i.itemId, i.cooking],
          );
        }
      }
    });
    return this.today(v);
  }

  async slots(v: VendorRef) {
    const rows = await this.dataSource.manager.find(PreorderSlot, {
      where: { branchId: v.branchId },
      order: { weekday: 'ASC', slotStart: 'ASC' },
    });
    return rows.map((s) => ({
      id: s.id,
      weekday: s.weekday,
      slotStart: s.slotStart.slice(0, 5),
      cutoffMinutesBefore: s.cutoffMinutesBefore,
      maxOrders: s.maxOrders,
    }));
  }

  /** Replaces the week's pre-order slots. */
  async replaceSlots(v: VendorRef, slots: PreorderSlotDto[]) {
    if (!v.isHomeKitchen)
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Pre-order slots are for home kitchens.',
      });
    const keys = slots.map((s) => `${s.weekday}|${s.slotStart}`);
    if (new Set(keys).size !== keys.length)
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Two slots at the same time.',
      });
    await this.dataSource.transaction(async (m) => {
      await m.delete(PreorderSlot, { branchId: v.branchId });
      if (slots.length)
        await m.insert(
          PreorderSlot,
          slots.map((s) => ({ ...s, branchId: v.branchId })),
        );
    });
    return this.slots(v);
  }

  /** Which weekdays each dish is on (sets each item's days mask). */
  async weeklyMenu(v: VendorRef, entries: WeeklyMenuEntryDto[]) {
    await this.assertItems(
      v,
      entries.map((e) => e.itemId),
    );
    await this.dataSource.transaction(async (m) => {
      for (const e of entries)
        await m.update(
          MenuItem,
          { id: e.itemId, brandId: v.brandId },
          { daysMask: maskOf(e.days) },
        );
    });
    const rows = await this.dataSource.manager.find(MenuItem, {
      where: { brandId: v.brandId },
      order: { sort: 'ASC' },
    });
    return rows.map((r) => ({
      itemId: r.id,
      name: r.name,
      days: daysOf(r.daysMask),
    }));
  }

  /** Remaining capacity of upcoming slots (customer `GET /food/vendors/:id/slots`). */
  async upcomingSlots(
    branchId: string,
    tz: string,
    days = 7,
    now = new Date(),
  ) {
    const slots = await this.dataSource.manager.find(PreorderSlot, {
      where: { branchId },
    });
    if (!slots.length) return [];
    const today = localDate(now, tz);
    const out: Array<{
      slotId: string;
      startsAt: Date;
      cutoffAt: Date;
      maxOrders: number;
    }> = [];
    for (let i = 0; i < days; i++) {
      const date = addDays(today, i);
      for (const s of slots.filter((x) => x.weekday === weekdayOf(date))) {
        const startsAt = wallTimeToInstant(
          date,
          parseTime(s.slotStart.slice(0, 5)),
          tz,
        );
        if (!startsAt) continue;
        const cutoffAt = new Date(
          startsAt.getTime() - s.cutoffMinutesBefore * 60_000,
        );
        if (cutoffAt > now)
          out.push({
            slotId: s.id,
            startsAt,
            cutoffAt,
            maxOrders: s.maxOrders,
          });
      }
    }
    out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    return out;
  }
}
