import { bestMatch, normalizeText, similarity } from './fuzzy';

describe('fuzzy text', () => {
  it('normalises Urdu digits, diacritics and punctuation', () => {
    expect(normalizeText('  Chicken-Biryani!! ۲۰ ')).toBe('chicken biryani 20');
    expect(normalizeText('قورمہ، ختم۔')).toBe('قورمہ ختم');
  });

  it('scores spellings, word parts and strangers', () => {
    expect(similarity('Chicken Biryani', 'chicken biryani')).toBe(1);
    expect(similarity('biryani', 'Chicken Biryani')).toBeGreaterThanOrEqual(
      0.75,
    );
    expect(similarity('biriyani', 'biryani')).toBeGreaterThan(0.5);
    expect(similarity('karahi', 'zinger burger')).toBeLessThan(0.2);
    expect(similarity('', 'x')).toBe(0);
  });

  it('bestMatch returns the winner and the runners-up above the floor', () => {
    const r = bestMatch('biryani', [
      { value: 'a', names: ['Chicken Biryani', 'چکن بریانی'] },
      { value: 'b', names: ['Beef Biryani'] },
      { value: 'c', names: ['Zinger Burger'] },
    ]);
    expect(r.best?.value).toBe('a');
    expect(r.others.map((o) => o.value)).toEqual(['b']);
    expect(
      bestMatch('چکن بریانی', [
        { value: 'a', names: ['Chicken Biryani', 'چکن بریانی'] },
      ]).best?.score,
    ).toBe(1);
    expect(
      bestMatch('pizza', [{ value: 'a', names: ['Haleem'] }]).best,
    ).toBeNull();
  });
});
