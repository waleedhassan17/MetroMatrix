import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LocationPointDto } from './dto/delivery.dto';
import { LOCATION_FANOUT_MS } from './presence';
import { ErrorCode } from '../../../common/errors/codes';

export interface RiderLocationPayload {
  orderId: string;
  lat: number;
  lng: number;
  heading: number | null;
  speed: number | null;
  at: string;
}

export type LocationResult =
  { ok: true; accepted: number } | { ok: false; code: string; message: string };

/** Orders a rider is carrying or about to carry. */
const RIDER_ACTIVE = `status IN ('accepted', 'preparing', 'ready', 'on_the_way')`;

/**
 * Rider GPS: the socket's `rider.location` and the REST batch both land
 * here. Fixes are stored (rider_location_logs), the rider's last position
 * is updated, and the latest fix is fanned out to each order's room — at
 * most once every 4 s per order. A rider off duty, or naming an order that
 * isn't theirs, is refused.
 */
@Injectable()
export class RiderLocationService {
  /** Set by the realtime gateway. */
  fanOut: (payload: RiderLocationPayload) => void = () => undefined;
  private readonly lastFanOut = new Map<string, number>();

  constructor(private readonly dataSource: DataSource) {}

  async record(
    riderId: string,
    points: LocationPointDto[],
    now = new Date(),
  ): Promise<LocationResult> {
    const [rider] = await this.dataSource.query(
      `SELECT on_duty, status FROM riders WHERE id = $1`,
      [riderId],
    );
    if (!rider || rider.status !== 'active' || !rider.on_duty)
      return {
        ok: false,
        code: ErrorCode.RIDER_NOT_AVAILABLE,
        message: 'Go on duty to share your location.',
      };
    const active: string[] = (
      await this.dataSource.query(
        `SELECT id FROM food_orders WHERE rider_id = $1 AND ${RIDER_ACTIVE}`,
        [riderId],
      )
    ).map((r: any) => r.id);
    if (points.some((p) => p.orderId && !active.includes(p.orderId)))
      return {
        ok: false,
        code: ErrorCode.RIDER_NOT_ASSIGNED,
        message: 'That order isn’t assigned to you.',
      };
    const fixes = points
      .map((p) => {
        const at = p.at ? new Date(p.at) : now;
        return { ...p, at: at > now ? now : at };
      })
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    const single = active.length === 1 ? active[0] : null;
    await this.dataSource.query(
      `INSERT INTO rider_location_logs (rider_id, order_id, lat, lng, heading, speed, accuracy, at)
       SELECT $1, x.order_id, x.lat, x.lng, x.heading, x.speed, x.accuracy, x.at
         FROM jsonb_to_recordset($2::jsonb) AS x(order_id uuid, lat numeric, lng numeric,
              heading smallint, speed numeric, accuracy numeric, at timestamptz)`,
      [
        riderId,
        JSON.stringify(
          fixes.map((f) => ({
            order_id: f.orderId ?? single,
            lat: f.lat,
            lng: f.lng,
            heading: f.heading === undefined ? null : Math.round(f.heading),
            speed: f.speed ?? null,
            accuracy: f.accuracy ?? null,
            at: f.at.toISOString(),
          })),
        ),
      ],
    );
    const last = fixes[fixes.length - 1];
    await this.dataSource.query(
      `UPDATE riders SET last_geo = ST_SetSRID(ST_MakePoint($2::float8, $3::float8), 4326)::geography,
              location_updated_at = $4, updated_at = now()
        WHERE id = $1 AND (location_updated_at IS NULL OR location_updated_at <= $4)`,
      [riderId, last.lng, last.lat, last.at],
    );
    const targets = last.orderId ? [last.orderId] : active;
    for (const orderId of targets) {
      const prev = this.lastFanOut.get(orderId) ?? 0;
      if (now.getTime() - prev < LOCATION_FANOUT_MS) continue;
      this.lastFanOut.set(orderId, now.getTime());
      this.fanOut({
        orderId,
        lat: last.lat,
        lng: last.lng,
        heading: last.heading ?? null,
        speed: last.speed ?? null,
        at: last.at.toISOString(),
      });
    }
    if (this.lastFanOut.size > 10_000) this.lastFanOut.clear();
    return { ok: true, accepted: fixes.length };
  }

  /** Jobs: location history older than `before` goes. */
  async purge(before: Date): Promise<number> {
    const [, n] = await this.dataSource.query(
      `DELETE FROM rider_location_logs WHERE at < $1`,
      [before],
    );
    return n ?? 0;
  }
}
