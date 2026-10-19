import { normalizeQuery } from './query-norm';

describe('search query normalisation', () => {
  it('lower case, punctuation out, single spaces', () => {
    expect(normalizeQuery('  Chicken   KARAHI!! ')).toBe('chicken karahi');
    expect(normalizeQuery('biryani, near me?')).toBe('biryani near me');
  });

  it('keeps Urdu script and short numbers; drops phone-like digit runs', () => {
    expect(normalizeQuery('بریانی')).toBe('بریانی');
    expect(normalizeQuery('2 naan')).toBe('2 naan');
    expect(normalizeQuery('call 03001234567 karahi')).toBe('call karahi');
  });

  it('nothing useful → null; at most 60 characters', () => {
    expect(normalizeQuery('')).toBeNull();
    expect(normalizeQuery(undefined)).toBeNull();
    expect(normalizeQuery('!')).toBeNull();
    expect(normalizeQuery('a'.repeat(80))).toHaveLength(60);
  });
});
