import { durationMs } from './duration';
import { randomToken, safeEqualHex, sha256Hex } from './hash';
import { generateOtp, hashCode, verifyCode } from './otp';

describe('crypto helpers', () => {
  it('generates 6-digit, zero-padded OTPs', () => {
    for (let i = 0; i < 200; i++) expect(generateOtp()).toMatch(/^\d{6}$/);
  });

  it('binds an OTP hash to pepper, purpose and owner', () => {
    const h = hashCode('pepper', 'verify', 'user-1', '123456');
    expect(verifyCode('pepper', 'verify', 'user-1', '123456', h)).toBe(true);
    expect(verifyCode('pepper', 'verify', 'user-1', '123457', h)).toBe(false);
    expect(verifyCode('other', 'verify', 'user-1', '123456', h)).toBe(false);
    expect(verifyCode('pepper', 'reset', 'user-1', '123456', h)).toBe(false);
    expect(verifyCode('pepper', 'verify', 'user-2', '123456', h)).toBe(false);
  });

  it('compares digests safely, including mismatched lengths', () => {
    const a = sha256Hex('x');
    expect(safeEqualHex(a, sha256Hex('x'))).toBe(true);
    expect(safeEqualHex(a, sha256Hex('y'))).toBe(false);
    expect(safeEqualHex(a, 'abcd')).toBe(false);
    expect(safeEqualHex('', '')).toBe(false);
  });

  it('makes distinct url-safe tokens', () => {
    const t = randomToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(t);
  });

  it('parses durations', () => {
    expect(durationMs('15m')).toBe(900_000);
    expect(durationMs('30d')).toBe(2_592_000_000);
    expect(() => durationMs('15 minutes')).toThrow();
  });
});
