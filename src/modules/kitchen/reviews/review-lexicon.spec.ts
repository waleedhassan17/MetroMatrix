import { anonymise, lexiconThemes, weeklyHeadline } from './review-lexicon';

describe('review themes without AI', () => {
  const reviews = [
    {
      rating: 2,
      text: 'Fries were cold and the raita leaked. Call me on 0300 1234567.',
    },
    { rating: 3, text: 'Karahi was mazedar but thanda by the time it came' },
    { rating: 2, text: 'Everything came cold, very late.' },
    { rating: 5, text: 'Delicious and fresh, rider Ali was polite' },
    { rating: 1, text: 'Not fresh at all' },
    { rating: 4, text: 'مزیدار کڑاہی، جلدی پہنچ گئی' },
  ];
  it('counts themes in English, Roman Urdu and Urdu; ratings guard the sentiment', () => {
    const t = lexiconThemes(reviews);
    expect(t[0]).toMatchObject({
      theme: 'cold food',
      sentiment: 'negative',
      count: 3,
    });
    expect(t.find((x) => x.theme === 'tasty food')!.count).toBe(3);
    // "Not fresh" in a 1★ review is not praise.
    expect(t.find((x) => x.theme === 'fresh food')!.count).toBe(1);
    expect(t.find((x) => x.theme === 'quick delivery')!.count).toBe(1);
    expect(t.find((x) => x.theme === 'packaging spilled')!.count).toBe(1);
  });

  it('examples are anonymised and short', () => {
    const cold = lexiconThemes(reviews)[0];
    expect(cold.examples).toHaveLength(2);
    expect(cold.examples.join(' ')).not.toMatch(/0300/);
    expect(anonymise('rider Ali was polite, mail a@b.com')).toBe(
      'rider was polite, mail …',
    );
    expect(anonymise('x'.repeat(150))).toHaveLength(100);
  });

  it('the weekly headline names the top complaint', () => {
    expect(weeklyHeadline(lexiconThemes(reviews))).toBe(
      'This week: 3 reviews mention cold food',
    );
    expect(weeklyHeadline([])).toBeNull();
  });
});
