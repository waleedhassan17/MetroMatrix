import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ErrorCode } from '../../../common/errors/codes';
import {
  formatTime12,
  localDate,
  shortDateLabel,
  toZonedIso,
} from '../../../common/time/time.util';
import { BranchSchedule } from '../availability/branch-state.service';
import { BranchRow } from '../availability/serviceability.service';
import { isWithinHours } from '../availability/open-state';
import { MenuAvailabilityService } from '../menu/menu-availability.service';
import { VISIBLE_VENDOR_SQL } from '../discovery/discovery.service';
import { NEGATIVE_END } from '../orders/food-order-status';

/** A scheduled order is at least this far ahead (or prep time, if longer). */
export const MIN_LEAD_MINUTES = 30;
export const MAX_AHEAD_DAYS = 7;

export interface ScheduleIssue {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface SlotChoice {
  slotId: string;
  startsAt: Date;
  cutoffAt: Date;
  maxOrders: number;
  remaining: number;
}

const NEGATIVE = NEGATIVE_END.map((s) => `'${s}'`).join(', ');

/**
 * "Can this vendor take an order for that time?" — the rule for scheduled
 * orders, shared by the cart, preview and checkout. Vendors with pre-order
 * slots (home kitchens) take scheduled orders only at a slot's start and
 * until its cutoff, up to its capacity; everyone else at any time inside
 * their hours, at least MIN_LEAD_MINUTES ahead.
 */
@Injectable()
export class FoodScheduleService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly availability: MenuAvailabilityService,
  ) {}

  /** Orders already holding a place in a slot occurrence. */
  async taken(
    m: EntityManager,
    slotId: string,
    startsAt: Date,
  ): Promise<number> {
    const [{ n }] = await m.query(
      `SELECT count(*)::int AS n FROM food_orders
        WHERE slot_id = $1 AND scheduled_for = $2 AND status NOT IN (${NEGATIVE})`,
      [slotId, startsAt],
    );
    return n;
  }

  async check(
    m: EntityManager,
    branch: BranchRow,
    schedule: BranchSchedule,
    at: Date,
    now: Date,
  ): Promise<{ issue: ScheduleIssue | null; slot: SlotChoice | null }> {
    const tz = branch.timezone;
    if (at.getTime() > now.getTime() + MAX_AHEAD_DAYS * 86_400_000)
      return {
        issue: {
          code: ErrorCode.SLOT_INVALID,
          message: `You can schedule up to ${MAX_AHEAD_DAYS} days ahead.`,
        },
        slot: null,
      };
    const [usesSlots] = await m.query(
      `SELECT 1 FROM preorder_slots WHERE branch_id = $1 LIMIT 1`,
      [branch.id],
    );
    if (usesSlots) {
      const slots = await this.availability.upcomingSlots(
        branch.id,
        tz,
        MAX_AHEAD_DAYS + 1,
        now,
      );
      const s = slots.find((x) => x.startsAt.getTime() === at.getTime());
      if (!s)
        return {
          issue: {
            code: ErrorCode.SLOT_INVALID,
            message:
              'Choose one of the kitchen’s pre-order slots (orders for a slot close before it starts).',
          },
          slot: null,
        };
      const remaining = Math.max(
        0,
        s.maxOrders - (await this.taken(m, s.slotId, s.startsAt)),
      );
      const slot = { ...s, remaining };
      if (remaining <= 0)
        return {
          issue: {
            code: ErrorCode.SLOT_FULL,
            message: `The ${formatTime12(s.startsAt, tz)} slot is full — choose another.`,
            details: { slotId: s.slotId, startsAt: toZonedIso(s.startsAt, tz) },
          },
          slot,
        };
      return { issue: null, slot };
    }
    if (branch.preorder_only)
      return {
        issue: {
          code: ErrorCode.SLOT_INVALID,
          message: 'This kitchen hasn’t opened pre-order slots yet.',
        },
        slot: null,
      };
    const lead = Math.max(MIN_LEAD_MINUTES, branch.prep_minutes);
    if (at.getTime() < now.getTime() + lead * 60_000)
      return {
        issue: {
          code: ErrorCode.SLOT_INVALID,
          message: `Choose a time at least ${lead} minutes from now.`,
          details: { minLeadMinutes: lead },
        },
        slot: null,
      };
    if (!isWithinHours(schedule.hours, schedule.closures, tz, at))
      return {
        issue: {
          code: ErrorCode.VENDOR_CLOSED,
          message: `Closed at ${formatTime12(at, tz)} on ${shortDateLabel(localDate(at, tz))} — choose a time inside opening hours.`,
          details: { scheduledFor: toZonedIso(at, tz) },
        },
        slot: null,
      };
    return { issue: null, slot: null };
  }

  /** GET /food/vendors/:id/slots — the next week's slots with places left. */
  async slotsFor(vendor: string, now = new Date()) {
    const [b] = await this.dataSource.query(
      `SELECT br.id, br.timezone, br.preorder_only FROM food_brands fb
         JOIN branches br ON br.brand_id = fb.id JOIN businesses b ON b.id = fb.business_id
        WHERE (fb.id::text = $1 OR fb.slug = $1) AND ${VISIBLE_VENDOR_SQL}`,
      [vendor],
    );
    if (!b)
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'This vendor is not on Food Court.',
      });
    const slots = await this.availability.upcomingSlots(
      b.id,
      b.timezone,
      MAX_AHEAD_DAYS,
      now,
    );
    const items = [];
    for (const s of slots) {
      const remaining = Math.max(
        0,
        s.maxOrders -
          (await this.taken(this.dataSource.manager, s.slotId, s.startsAt)),
      );
      items.push({
        slotId: s.slotId,
        startsAt: toZonedIso(s.startsAt, b.timezone),
        cutoffAt: toZonedIso(s.cutoffAt, b.timezone),
        label: `${shortDateLabel(localDate(s.startsAt, b.timezone))} · ${formatTime12(s.startsAt, b.timezone)}`,
        maxOrders: s.maxOrders,
        remaining,
        full: remaining === 0,
      });
    }
    return {
      timezone: b.timezone,
      preorderOnly: b.preorder_only,
      usesSlots: slots.length > 0,
      slots: items,
    };
  }
}
