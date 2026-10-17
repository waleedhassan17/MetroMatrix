import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  HoursRange,
  Interval,
  OpenState,
  openState,
  toMinutes,
} from './open-state';
import { FeeBand } from './delivery-quote';

export interface BranchSchedule {
  hours: HoursRange[];
  closures: Interval[];
  bands: FeeBand[];
}

/** The fields of a branch the open-state and quote logic need. */
export interface BranchCore {
  id: string;
  timezone: string;
  is_paused: boolean;
  pause_message: string | null;
  busy_until: Date | null;
  busy_extra_minutes: number;
  prep_minutes: number;
}

/**
 * Loads hours, closures and fee bands for many branches in three queries, and
 * answers "open now?" for them. Used by the vendor screens, discovery, cart
 * preview and checkout, so they never disagree.
 */
@Injectable()
export class BranchStateService {
  constructor(private readonly dataSource: DataSource) {}

  async schedules(
    branchIds: string[],
    now = new Date(),
    m: EntityManager = this.dataSource.manager,
  ): Promise<Map<string, BranchSchedule>> {
    const out = new Map<string, BranchSchedule>(
      branchIds.map((id) => [id, { hours: [], closures: [], bands: [] }]),
    );
    if (!branchIds.length) return out;
    const [hours, closures, bands] = await Promise.all([
      m.query(
        `SELECT branch_id, weekday, opens_at::text AS opens_at, closes_at::text AS closes_at
           FROM branch_hours WHERE branch_id = ANY($1::uuid[])`,
        [branchIds],
      ),
      m.query(
        `SELECT branch_id, starts_at, ends_at FROM branch_closures
          WHERE branch_id = ANY($1::uuid[]) AND ends_at > $2::timestamptz - interval '1 day'`,
        [branchIds, now],
      ),
      m.query(
        `SELECT branch_id, from_km, to_km, fee, min_order FROM delivery_fee_bands
          WHERE branch_id = ANY($1::uuid[]) ORDER BY from_km`,
        [branchIds],
      ),
    ]);
    for (const h of hours)
      out.get(h.branch_id)!.hours.push({
        weekday: h.weekday,
        opens: toMinutes(h.opens_at),
        closes: toMinutes(h.closes_at),
      });
    for (const c of closures)
      out.get(c.branch_id)!.closures.push({
        start: new Date(c.starts_at),
        end: new Date(c.ends_at),
      });
    for (const b of bands)
      out.get(b.branch_id)!.bands.push({
        fromKm: parseFloat(b.from_km),
        toKm: parseFloat(b.to_km),
        fee: b.fee,
        minOrder: b.min_order,
      });
    return out;
  }

  /** Busy mode counts only while `busy_until` is ahead. */
  busyExtra(b: BranchCore, now = new Date()): number {
    return b.busy_until && new Date(b.busy_until).getTime() > now.getTime()
      ? b.busy_extra_minutes
      : 0;
  }

  state(b: BranchCore, s: BranchSchedule, now = new Date()): OpenState {
    return openState({
      hours: s.hours,
      closures: s.closures,
      tz: b.timezone,
      now,
      paused: b.is_paused,
      pauseMessage: b.pause_message,
    });
  }
}
