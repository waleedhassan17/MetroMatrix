import { maskEmail } from './mask-email';

describe('maskEmail', () => {
  it('keeps the first letters and the top-level domain only', () => {
    expect(maskEmail('jane.doe@example.com')).toBe('j***@e***.com');
    expect(maskEmail('ali@mail.metromatrix.pk')).toBe('a***@m***.pk');
  });

  it('uses the last @ and trims', () => {
    expect(maskEmail('  "a@b"@example.org ')).toBe('"***@e***.org');
  });

  it('never echoes something that is not an address', () => {
    expect(maskEmail('')).toBe('***');
    expect(maskEmail(null)).toBe('***');
    expect(maskEmail('no-at-sign')).toBe('***');
    expect(maskEmail('@example.com')).toBe('***');
    expect(maskEmail('x@localhost')).toBe('x***@***');
  });
});
