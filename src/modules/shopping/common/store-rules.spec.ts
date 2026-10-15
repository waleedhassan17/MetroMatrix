import { contrastRatio, INK, onBrandColor, WHITE } from './contrast';
import {
  buildPkIban,
  ibanChecksumOk,
  normalizeAccountNumber,
} from '../../../common/payments/payment-account.validation';

describe('brand colour contrast', () => {
  it('matches known WCAG ratios', () => {
    expect(contrastRatio('#000000', WHITE)).toBeCloseTo(21, 1);
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 5);
  });

  it('picks the readable text colour, or refuses the colour', () => {
    expect(onBrandColor('#16151A')).toBe(WHITE); // ink → white text
    expect(onBrandColor('#BE123C')).toBe(WHITE); // deep rose
    expect(onBrandColor('#FACC15')).toBe(INK); // yellow → ink text
    expect(onBrandColor('#777777')).toBeNull(); // mid grey fails both
    expect(onBrandColor('#E879F9')).toBe(INK);
  });
});

describe('payment account numbers', () => {
  const iban = buildPkIban('MEZN', '0001234567890123');

  it('accepts a valid IBAN in any case with spaces, and refuses typos', () => {
    expect(ibanChecksumOk(iban)).toBe(true);
    const spaced = iban.toLowerCase().replace(/(.{4})/g, '$1 ');
    expect(normalizeAccountNumber('bank', spaced)).toEqual({
      ok: true,
      value: iban,
    });
    const typo = iban.slice(0, -1) + ((Number(iban.slice(-1)) + 1) % 10);
    expect(normalizeAccountNumber('bank', typo).ok).toBe(false);
    expect(normalizeAccountNumber('bank', 'GB82WEST12345698765432').ok).toBe(
      false,
    );
  });

  it('wallets and Raast take the PK mobile, normalised', () => {
    for (const kind of ['jazzcash', 'easypaisa', 'raast'] as const) {
      expect(normalizeAccountNumber(kind, '0312 4890176')).toEqual({
        ok: true,
        value: '+923124890176',
      });
      expect(normalizeAccountNumber(kind, '042 35761234').ok).toBe(false);
      expect(normalizeAccountNumber(kind, iban).ok).toBe(false);
    }
  });
});
