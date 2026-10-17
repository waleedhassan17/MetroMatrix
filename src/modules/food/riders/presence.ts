/**
 * Ported from FinMatrix presence.constants: being on duty is the rider's
 * choice; a location is "live" only if it arrived in the last two minutes.
 * Suggestions use distance only from a live location.
 */
export const LOCATION_LIVE_MS = 2 * 60_000;
/** rider.location fan-out: at most one per order every 4 seconds. */
export const LOCATION_FANOUT_MS = 4_000;
/** Location history is kept 14 days (jobs purge older rows). */
export const LOCATION_RETENTION_DAYS = 14;

export const isLocationLive = (
  updatedAt: Date | null | undefined,
  now: Date = new Date(),
): boolean =>
  !!updatedAt &&
  now.getTime() - new Date(updatedAt).getTime() <= LOCATION_LIVE_MS;
