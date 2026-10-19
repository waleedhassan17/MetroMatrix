import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  BranchCore,
  BranchSchedule,
  BranchStateService,
} from './branch-state.service';
import { deliveryQuote, etaLabel, etaMinutes } from './delivery-quote';
import { OpenState } from './open-state';
import { sizeBucketOf } from './entities/prep-time-stat.entity';
import { localMinutes } from '../../../common/time/time.util';

const localHour = (now: Date, tz: string) =>
  Math.floor(localMinutes(now, tz) / 60);

export interface BranchRow extends BranchCore {
  business_id: string;
  brand_id: string;
  accepts_delivery: boolean;
  accepts_pickup: boolean;
  accepts_cod: boolean;
  cod_limit: number;
  max_radius_km: string | number;
  free_delivery_over: number | null;
  preorder_only: boolean;
  transfer_confirm_before_prep: boolean;
  auto_reject_minutes: number;
  status: string;
  lat: number | null;
  lng: number | null;
  /** Metres from the customer's point (null when no point was given). */
  distance_m: number | null;
  /** Learned prep times: { "13:1-2": 24 } — p75 minutes per local hour and size, buckets with ≥ 20 samples. */
  prep_stats?: Record<string, number> | null;
}

export interface Quote {
  fulfilment: 'delivery' | 'pickup';
  /** Inside the radius (pickup: always). */
  serviceable: boolean;
  distanceKm: number | null;
  deliveryFee: number;
  baseDeliveryFee: number;
  minOrder: number;
  freeDeliveryOver: number | null;
  eta: { min: number; max: number };
  etaLabel: string;
  /** Kitchen minutes used: learned (p75 of real prep times) or the vendor's setting. */
  prepMinutes: number;
  prepSource: 'learned' | 'configured';
  open: OpenState;
}

/** Smart ETA (Chunk 5): enough real samples for this hour and size → their p75. */
export const LEARNED_PREP_MIN_SAMPLES = 20;

/** SELECT list for a branch row, with the distance to a point ($lat/$lng as params) when given. */
export const branchColumns = (latParam?: string, lngParam?: string) => `
  br.id, br.business_id, br.brand_id, br.timezone, br.is_paused, br.pause_message, br.busy_until,
  br.busy_extra_minutes, br.prep_minutes, br.accepts_delivery, br.accepts_pickup, br.accepts_cod,
  br.cod_limit, br.max_radius_km, br.free_delivery_over, br.preorder_only, br.transfer_confirm_before_prep,
  br.auto_reject_minutes, br.status,
  (SELECT jsonb_object_agg(ps.hour_bucket || ':' || ps.size_bucket, ps.p75_minutes)
     FROM prep_time_stats ps WHERE ps.branch_id = br.id AND ps.samples >= ${LEARNED_PREP_MIN_SAMPLES}) AS prep_stats,
  ST_Y(br.geo::geometry) AS lat, ST_X(br.geo::geometry) AS lng,
  ${
    latParam
      ? `ST_Distance(br.geo, ST_SetSRID(ST_MakePoint(${lngParam}::float8, ${latParam}::float8), 4326)::geography)`
      : 'NULL::float8'
  } AS distance_m`;

/**
 * "Can this vendor serve this point, for how much, how soon?" — one answer
 * for discovery, the vendor page, cart preview and checkout. Distance is
 * PostGIS geodesic (no paid Directions API); the ETA is computed.
 */
@Injectable()
export class ServiceabilityService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly state: BranchStateService,
  ) {}

  /** One branch, with distance to the point when given. */
  async branch(
    branchId: string,
    point: { lat: number; lng: number } | null,
    m: EntityManager = this.dataSource.manager,
  ): Promise<BranchRow | null> {
    const params: unknown[] = [branchId];
    let cols = branchColumns();
    if (point) {
      params.push(point.lat, point.lng);
      cols = branchColumns('$2', '$3');
    }
    const [row] = await m.query(
      `SELECT ${cols} FROM branches br WHERE br.id = $1`,
      params,
    );
    return row ?? null;
  }

  quote(
    b: BranchRow,
    s: BranchSchedule,
    fulfilment: 'delivery' | 'pickup',
    opts: { subtotal?: number; now?: Date; items?: number } = {},
  ): Quote {
    const now = opts.now ?? new Date();
    const learned =
      b.prep_stats?.[
        `${localHour(now, b.timezone)}:${sizeBucketOf(opts.items ?? 1)}`
      ];
    const prepMinutes = learned ?? b.prep_minutes;
    const km =
      b.distance_m === null
        ? null
        : Math.round((b.distance_m / 1000) * 10) / 10;
    const radius =
      typeof b.max_radius_km === 'string'
        ? parseFloat(b.max_radius_km)
        : b.max_radius_km;
    const serviceable =
      fulfilment === 'pickup'
        ? b.accepts_pickup
        : b.accepts_delivery && km !== null && km <= radius;
    const q =
      fulfilment === 'delivery'
        ? deliveryQuote({
            bands: s.bands,
            km: km ?? 0,
            freeDeliveryOver: b.free_delivery_over,
            subtotal: opts.subtotal,
          })
        : { fee: 0, baseFee: 0, minOrder: 0, freeDeliveryOver: null };
    const eta = etaMinutes({
      prepMinutes,
      busyExtraMinutes: this.state.busyExtra(b, now),
      km: km ?? 0,
      fulfilment,
    });
    return {
      fulfilment,
      serviceable,
      distanceKm: km,
      deliveryFee: q.fee,
      baseDeliveryFee: q.baseFee,
      minOrder: q.minOrder,
      freeDeliveryOver: q.freeDeliveryOver,
      eta,
      etaLabel: etaLabel(eta),
      prepMinutes,
      prepSource: learned !== undefined ? 'learned' : 'configured',
      open: this.state.state(b, s, now),
    };
  }
}
