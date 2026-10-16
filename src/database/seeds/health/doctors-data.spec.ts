import { parseTime } from '../../../modules/healthcare/common/time.util';
import {
  CLINIC_HOURS,
  DEMO_DOCTORS,
  DEMO_HEALTH_BANNERS,
  DEMO_PORTRAITS,
  SPECIALTY_PROFILE,
  VIDEO_HOURS,
  portraitUrl,
} from './doctors-data';

describe('seed:health data', () => {
  it('30 fictional doctors, 12 specialties, 3 cities, video for half, unique keys', () => {
    expect(DEMO_DOCTORS).toHaveLength(30);
    expect(new Set(DEMO_DOCTORS.map((d) => d.key)).size).toBe(30);
    expect(new Set(DEMO_DOCTORS.map((d) => d.specialty)).size).toBe(12);
    expect(new Set(DEMO_DOCTORS.map((d) => d.city))).toEqual(
      new Set(['Lahore', 'Karachi', 'Islamabad']),
    );
    expect(DEMO_DOCTORS.filter((d) => d.video)).toHaveLength(15);
    for (const d of DEMO_DOCTORS)
      expect(SPECIALTY_PROFILE[d.specialty]).toBeDefined();
  });

  it('clinic hours and video hours never overlap (the API would refuse them)', () => {
    const all = [...CLINIC_HOURS.flat(), ...VIDEO_HOURS].map(([wd, s, e]) => ({
      wd,
      s: parseTime(s),
      e: parseTime(e),
    }));
    for (const [i, a] of all.entries())
      for (const b of all.slice(i + 1))
        if (a.wd === b.wd) expect(a.e <= b.s || b.e <= a.s).toBe(true);
  });

  it('every doctor has their own portrait, cropped to the face; banners open real places', () => {
    const ids = DEMO_DOCTORS.map((d) => DEMO_PORTRAITS[d.key]);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(DEMO_DOCTORS.length);
    expect(Object.keys(DEMO_PORTRAITS).sort()).toEqual(
      DEMO_DOCTORS.map((d) => d.key).sort(),
    );
    expect(portraitUrl(ids[0]!)).toMatch(
      /^https:\/\/images\.unsplash\.com\/photo-[\w-]+\?.*fit=facearea/,
    );

    expect(DEMO_HEALTH_BANNERS).toHaveLength(5);
    expect(new Set(DEMO_HEALTH_BANNERS.map((b) => b.title)).size).toBe(5);
    expect(new Set(DEMO_HEALTH_BANNERS.map((b) => b.photo)).size).toBe(5);
    for (const b of DEMO_HEALTH_BANNERS) {
      expect(b.title.length).toBeLessThanOrEqual(80);
      expect(b.subtitle.length).toBeLessThanOrEqual(140);
      if (b.target.type === 'specialty')
        expect(SPECIALTY_PROFILE[b.target.slug]).toBeDefined();
    }
  });
});
