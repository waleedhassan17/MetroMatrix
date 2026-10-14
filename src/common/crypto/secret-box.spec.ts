import { randomBytes } from 'crypto';
import { open, seal } from './secret-box';

describe('secret-box (AES-256-GCM)', () => {
  const key = randomBytes(32).toString('base64');

  it('round-trips and never repeats a ciphertext', () => {
    const a = seal('JBSWY3DPEHPK3PXP', key);
    const b = seal('JBSWY3DPEHPK3PXP', key);
    expect(a).not.toBe(b);
    expect(a.startsWith('v1.')).toBe(true);
    expect(a).not.toContain('JBSWY3DPEHPK3PXP');
    expect(open(a, key)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('refuses a tampered value and the wrong key', () => {
    const sealed = seal('secret', key);
    const parts = sealed.split('.');
    const flipped = Buffer.from(parts[3], 'base64url');
    flipped[0] ^= 1;
    parts[3] = flipped.toString('base64url');
    expect(() => open(parts.join('.'), key)).toThrow();
    expect(() => open(sealed, randomBytes(32).toString('base64'))).toThrow();
  });

  it('insists on a 32-byte key', () => {
    expect(() => seal('x', randomBytes(16).toString('base64'))).toThrow(
      /32 bytes/,
    );
  });
});
