/**
 * Rider seats — ported from FinMatrix-Backend `delivery-personnel/rider-seats.ts`.
 *
 * Plans cap how many riders may be ACTIVE. When the cap goes down (an admin
 * override today; a smaller plan later), riders beyond it move to
 * `plan_locked`: account and history kept, but they can't use the rider app
 * or be assigned. When it goes back up, locked riders are restored first.
 *
 * Who keeps a seat is decided by the server, deterministically:
 *   1. riders with an order in progress — locking them would strand a delivery;
 *   2. then the longest-serving riders;
 *   3. user id as a final tie-break.
 * `inactive` and `on_leave` riders are never touched — those were the vendor's
 * decisions, not the plan's.
 */
import type { EntityManager } from 'typeorm';

export interface SeatCandidate {
  userId: string;
  status: 'active' | 'plan_locked';
  hasOpenDelivery: boolean;
  createdAt: Date;
}

export interface SeatPlan {
  lock: string[];
  unlock: string[];
}

/** Pure ranking — which candidates keep a seat under `limit`. */
export function planRiderSeats(
  candidates: SeatCandidate[],
  limit: number,
): SeatPlan {
  const ranked = [...candidates].sort((a, b) => {
    if (a.hasOpenDelivery !== b.hasOpenDelivery)
      return a.hasOpenDelivery ? -1 : 1;
    const byAge =
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    if (byAge !== 0) return byAge;
    return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
  });
  const seats = Math.max(0, limit);
  const lock: string[] = [];
  const unlock: string[] = [];
  ranked.forEach((c, i) => {
    const keeps = i < seats;
    if (keeps && c.status === 'plan_locked') unlock.push(c.userId);
    if (!keeps && c.status === 'active') lock.push(c.userId);
  });
  return { lock, unlock };
}

/**
 * Bring a business's active riders within `limit`, inside the caller's
 * transaction (rows locked FOR UPDATE so a concurrent activation can't slip
 * past). Locked riders' sessions end (token_version bump).
 */
export async function reconcileRiderSeats(
  em: EntityManager,
  businessId: string,
  limit: number,
): Promise<SeatPlan> {
  const rows: Array<{
    user_id: string;
    status: 'active' | 'plan_locked';
    created_at: Date;
    active_order_count: number;
  }> = await em.query(
    `SELECT user_id, status, created_at, active_order_count FROM riders
      WHERE business_id = $1 AND status IN ('active', 'plan_locked')
      ORDER BY user_id FOR UPDATE`,
    [businessId],
  );
  const plan = planRiderSeats(
    rows.map((r) => ({
      userId: r.user_id,
      status: r.status,
      hasOpenDelivery: r.active_order_count > 0,
      createdAt: r.created_at,
    })),
    limit,
  );
  if (plan.lock.length) {
    await em.query(
      `UPDATE riders SET status = 'plan_locked', on_duty = false, updated_at = now() WHERE user_id = ANY($1::uuid[])`,
      [plan.lock],
    );
    await em.query(
      `UPDATE users SET token_version = token_version + 1 WHERE id = ANY($1::uuid[])`,
      [plan.lock],
    );
  }
  if (plan.unlock.length) {
    await em.query(
      `UPDATE riders SET status = 'active', updated_at = now() WHERE user_id = ANY($1::uuid[])`,
      [plan.unlock],
    );
  }
  return plan;
}
