/**
 * Geohash (the standard base-32 encoding, the same as PostGIS `ST_GeoHash`).
 * Six characters is a cell of about 1.2 km × 0.6 km — what the demand map
 * shows, so a search is never stored with a finer location than that.
 */
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface GeohashCell extends GeoPoint {
  bounds: { south: number; west: number; north: number; east: number };
}

export function encodeGeohash(lat: number, lng: number, precision = 6): string {
  let [latLo, latHi, lngLo, lngHi] = [-90, 90, -180, 180];
  let hash = '';
  let bits = 0;
  let ch = 0;
  let evenBit = true; // longitude first
  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lngLo + lngHi) / 2;
      if (lng >= mid) {
        ch = (ch << 1) | 1;
        lngLo = mid;
      } else {
        ch <<= 1;
        lngHi = mid;
      }
    } else {
      const mid = (latLo + latHi) / 2;
      if (lat >= mid) {
        ch = (ch << 1) | 1;
        latLo = mid;
      } else {
        ch <<= 1;
        latHi = mid;
      }
    }
    evenBit = !evenBit;
    if (++bits === 5) {
      hash += BASE32[ch];
      bits = 0;
      ch = 0;
    }
  }
  return hash;
}

/** The cell's centre and bounds. Throws on a character outside the alphabet. */
export function decodeGeohash(hash: string): GeohashCell {
  let [latLo, latHi, lngLo, lngHi] = [-90, 90, -180, 180];
  let evenBit = true;
  for (const c of hash.toLowerCase()) {
    const idx = BASE32.indexOf(c);
    if (idx < 0) throw new Error(`Invalid geohash character "${c}"`);
    for (let n = 4; n >= 0; n--) {
      const bit = (idx >> n) & 1;
      if (evenBit) {
        const mid = (lngLo + lngHi) / 2;
        if (bit) lngLo = mid;
        else lngHi = mid;
      } else {
        const mid = (latLo + latHi) / 2;
        if (bit) latLo = mid;
        else latHi = mid;
      }
      evenBit = !evenBit;
    }
  }
  return {
    lat: (latLo + latHi) / 2,
    lng: (lngLo + lngHi) / 2,
    bounds: { south: latLo, west: lngLo, north: latHi, east: lngHi },
  };
}
