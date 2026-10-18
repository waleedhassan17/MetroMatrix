import {
  canonicalUnit,
  display,
  factorOf,
  pricePer,
  toBase,
  unitsFor,
} from './units';

const rice = {
  baseUnit: 'g' as const,
  customUnits: [{ name: 'bori', factor: 40000 }],
};
const eggs = {
  baseUnit: 'piece' as const,
  customUnits: [{ name: 'tray', factor: 30 }],
};
const milk = { baseUnit: 'ml' as const, customUnits: [] };

describe('kitchen units', () => {
  it('converts the standard units to the base unit', () => {
    expect(toBase(5, 'kg', rice)).toBe(5000);
    expect(toBase(250, 'g', rice)).toBe(250);
    expect(toBase(1.5, 'l', milk)).toBe(1500);
    expect(toBase(2, 'dozen', eggs)).toBe(24);
    expect(toBase(0.333, 'kg', rice)).toBe(333);
  });

  it('accepts spoken and Urdu spellings', () => {
    expect(canonicalUnit('Kilo')).toBe('kg');
    expect(canonicalUnit('کلو')).toBe('kg');
    expect(canonicalUnit('darjan')).toBe('dozen');
    expect(toBase(5, 'kilo', rice)).toBe(5000);
  });

  it('uses the ingredient’s own units', () => {
    expect(toBase(2, 'tray', eggs)).toBe(60);
    expect(toBase(1, 'bori', rice)).toBe(40000);
    expect(factorOf('tray', rice)).toBeNull();
  });

  it('refuses a unit of another kind with UNIT_MISMATCH and the allowed list', () => {
    try {
      toBase(1, 'l', rice);
      throw new Error('no throw');
    } catch (e: any) {
      expect(e.getResponse()).toMatchObject({
        code: 'UNIT_MISMATCH',
        details: { unit: 'l', baseUnit: 'g', allowed: ['g', 'kg', 'bori'] },
      });
    }
    expect(unitsFor(eggs)).toEqual(['piece', 'dozen', 'tray']);
  });

  it('shows quantities and prices the way people buy', () => {
    expect(display(5000, 'g')).toEqual({ qty: 5, unit: 'kg' });
    expect(display(-1250, 'g')).toEqual({ qty: -1.25, unit: 'kg' });
    expect(display(750, 'ml')).toEqual({ qty: 750, unit: 'ml' });
    expect(display(18, 'piece')).toEqual({ qty: 18, unit: 'piece' });
    expect(pricePer(0.24, 'g')).toEqual({ price: 240, per: 'kg' });
    expect(pricePer(30, 'piece')).toEqual({ price: 30, per: 'piece' });
  });
});
