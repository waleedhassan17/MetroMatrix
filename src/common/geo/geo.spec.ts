import { decodeGeohash, encodeGeohash } from './geohash';
import { bearingDeg, bearingDiff, haversineKm } from './bearing';

describe('geohash', () => {
  it('matches the published reference value', () => {
    // geohash.org's example: 57.64911, 10.40744 → u4pruydqqvj
    expect(encodeGeohash(57.64911, 10.40744, 11)).toBe('u4pruydqqvj');
    expect(encodeGeohash(57.64911, 10.40744)).toBe('u4pruy');
  });

  it('decodes to a cell containing the point; six characters ≈ 1.2 × 0.6 km', () => {
    const lahore = { lat: 31.5204, lng: 74.3587 };
    const h = encodeGeohash(lahore.lat, lahore.lng);
    expect(h).toHaveLength(6);
    const c = decodeGeohash(h);
    expect(c.bounds.south).toBeLessThanOrEqual(lahore.lat);
    expect(c.bounds.north).toBeGreaterThan(lahore.lat);
    expect(c.bounds.west).toBeLessThanOrEqual(lahore.lng);
    expect(c.bounds.east).toBeGreaterThan(lahore.lng);
    const widthKm = haversineKm(
      { lat: c.lat, lng: c.bounds.west },
      { lat: c.lat, lng: c.bounds.east },
    );
    const heightKm = haversineKm(
      { lat: c.bounds.south, lng: c.lng },
      { lat: c.bounds.north, lng: c.lng },
    );
    expect(widthKm).toBeGreaterThan(0.9);
    expect(widthKm).toBeLessThan(1.2);
    expect(heightKm).toBeCloseTo(0.61, 1);
    expect(encodeGeohash(c.lat, c.lng)).toBe(h);
    expect(() => decodeGeohash('abc')).toThrow(/Invalid geohash/);
  });
});

describe('bearing and distance', () => {
  const o = { lat: 0, lng: 0 };
  it('bearings: north 0°, east 90°, south 180°, west 270°', () => {
    expect(bearingDeg(o, { lat: 1, lng: 0 })).toBeCloseTo(0, 6);
    expect(bearingDeg(o, { lat: 0, lng: 1 })).toBeCloseTo(90, 6);
    expect(bearingDeg(o, { lat: -1, lng: 0 })).toBeCloseTo(180, 6);
    expect(bearingDeg(o, { lat: 0, lng: -1 })).toBeCloseTo(270, 6);
  });

  it('the difference between bearings wraps around north', () => {
    expect(bearingDiff(350, 10)).toBe(20);
    expect(bearingDiff(10, 350)).toBe(20);
    expect(bearingDiff(90, 270)).toBe(180);
    expect(bearingDiff(45, 45)).toBe(0);
    expect(bearingDiff(0, 46)).toBe(46);
  });

  it('one degree of latitude is about 111.2 km', () => {
    expect(haversineKm(o, { lat: 1, lng: 0 })).toBeCloseTo(111.2, 1);
    expect(haversineKm(o, o)).toBe(0);
  });
});
