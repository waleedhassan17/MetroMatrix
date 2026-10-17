/** A delivery band as stored (km from the branch). */
export interface FeeBand {
  fromKm: number;
  toKm: number;
  fee: number;
  minOrder: number;
}

/** Average city riding speed used for ETAs (no paid Directions API). */
export const RIDE_KMH = 22;
/** Hand-over at the door. */
export const HANDOFF_MINUTES = 5;
/** ETAs are shown as a 10-minute window. */
export const ETA_WINDOW_MINUTES = 10;

/**
 * The band for a distance: the one containing it, else the last band (the
 * radius check decides serviceability, not the bands). No bands = free, no minimum.
 */
export function bandFor(bands: FeeBand[], km: number): FeeBand | null {
  if (!bands.length) return null;
  const sorted = [...bands].sort((a, b) => a.fromKm - b.fromKm);
  return (
    sorted.find((b) => km >= b.fromKm && km < b.toKm) ??
    sorted[sorted.length - 1]
  );
}

/** The vendor's own delivery fee (the only fee a customer ever pays on Food Court). */
export function deliveryQuote(opts: {
  bands: FeeBand[];
  km: number;
  freeDeliveryOver: number | null;
  subtotal?: number;
}) {
  const band = bandFor(opts.bands, opts.km);
  const baseFee = band?.fee ?? 0;
  const freeOver = opts.freeDeliveryOver;
  const free =
    freeOver !== null &&
    opts.subtotal !== undefined &&
    opts.subtotal >= freeOver;
  return {
    fee: free ? 0 : baseFee,
    baseFee,
    minOrder: band?.minOrder ?? 0,
    freeDeliveryOver: freeOver,
  };
}

/** Minutes: prep (+busy) + riding at 22 km/h + hand-over; pickup is prep (+busy) only. */
export function etaMinutes(opts: {
  prepMinutes: number;
  busyExtraMinutes: number;
  km: number;
  fulfilment: 'delivery' | 'pickup';
}): { min: number; max: number } {
  const kitchen = opts.prepMinutes + opts.busyExtraMinutes;
  const base =
    opts.fulfilment === 'pickup'
      ? kitchen
      : kitchen + Math.ceil((opts.km / RIDE_KMH) * 60) + HANDOFF_MINUTES;
  return { min: base, max: base + ETA_WINDOW_MINUTES };
}

/** "25–35 min" */
export const etaLabel = (eta: { min: number; max: number }) =>
  `${eta.min}–${eta.max} min`;
