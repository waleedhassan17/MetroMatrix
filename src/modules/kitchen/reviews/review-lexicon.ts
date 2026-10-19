/**
 * Review themes without AI: a lexicon of what Pakistani food reviews keep
 * saying, in English, Roman Urdu and Urdu script. Pure and spec-tested; the
 * review_themes@1 prompt does the same job better when AI is on.
 */
export interface ReviewInput {
  rating: number;
  text: string;
}

export interface ReviewTheme {
  theme: string;
  sentiment: 'positive' | 'negative';
  count: number;
  examples: string[];
}

interface LexiconEntry {
  theme: string;
  sentiment: 'positive' | 'negative';
  words: string[];
}

export const REVIEW_LEXICON: LexiconEntry[] = [
  {
    theme: 'cold food',
    sentiment: 'negative',
    words: ['cold', 'thanda', 'thandi', 'ٹھنڈا', 'ٹھنڈی'],
  },
  {
    theme: 'late delivery',
    sentiment: 'negative',
    words: ['late', 'delay', 'delayed', 'der se', 'bohat der', 'دیر'],
  },
  {
    theme: 'too oily',
    sentiment: 'negative',
    words: ['oily', 'greasy', 'tel zyada', 'bohat tel', 'تیل'],
  },
  {
    theme: 'too spicy',
    sentiment: 'negative',
    words: ['too spicy', 'very spicy', 'mirch zyada', 'bohat mirch', 'تیز مرچ'],
  },
  {
    theme: 'small portions',
    sentiment: 'negative',
    words: [
      'small portion',
      'less quantity',
      'quantity kam',
      'kam quantity',
      'portion was small',
      'تھوڑا',
    ],
  },
  {
    theme: 'packaging spilled',
    sentiment: 'negative',
    words: [
      'spilled',
      'leaked',
      'leaking',
      'packaging was bad',
      'gir gaya',
      'لیک',
    ],
  },
  {
    theme: 'missing items',
    sentiment: 'negative',
    words: ['missing', 'forgot', 'nahi aaya', 'nahi bheja', 'غائب'],
  },
  {
    theme: 'too salty',
    sentiment: 'negative',
    words: ['salty', 'namak zyada', 'نمک زیادہ'],
  },
  {
    theme: 'overpriced',
    sentiment: 'negative',
    words: ['overpriced', 'expensive', 'mehnga', 'مہنگا'],
  },
  {
    theme: 'tasty food',
    sentiment: 'positive',
    words: [
      'tasty',
      'delicious',
      'mazedar',
      'mazay ka',
      'lazeez',
      'مزیدار',
      'لذیذ',
    ],
  },
  {
    theme: 'fresh food',
    sentiment: 'positive',
    words: ['fresh', 'taaza', 'تازہ'],
  },
  {
    theme: 'hot on arrival',
    sentiment: 'positive',
    words: ['piping hot', 'garam garam', 'still hot', 'arrived hot', 'گرم'],
  },
  {
    theme: 'generous portions',
    sentiment: 'positive',
    words: [
      'generous',
      'big portion',
      'quantity achi',
      'quantity zyada',
      'filling',
    ],
  },
  {
    theme: 'quick delivery',
    sentiment: 'positive',
    words: ['quick', 'fast delivery', 'on time', 'jaldi', 'جلدی'],
  },
  {
    theme: 'polite rider',
    sentiment: 'positive',
    words: ['polite', 'friendly rider', 'rider was nice', 'tameez', 'اخلاق'],
  },
  {
    theme: 'good value',
    sentiment: 'positive',
    words: ['value for money', 'worth', 'affordable', 'sasta', 'reasonable'],
  },
  {
    theme: 'home-style taste',
    sentiment: 'positive',
    words: ['ghar jaisa', 'homemade', 'home-style', 'like home', 'گھر جیسا'],
  },
];

/** Names, phone numbers and emails out; trimmed to 100 characters. */
export function anonymise(text: string): string {
  const t = text
    .replace(/\S+@\S+/g, '…')
    .replace(/\+?\d[\d\s-]{6,}\d/g, '…')
    .replace(/\b(rider|bhai|sir|madam)\s+[A-Z][a-z]+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > 100 ? `${t.slice(0, 99)}…` : t;
}

const has = (text: string, w: string) =>
  /[؀-ۿ]/.test(w)
    ? text.includes(w)
    : new RegExp(`(^|[^\\p{L}])${w}($|[^\\p{L}])`, 'iu').test(text);

/** The sentence around the word, anonymised. */
function snippet(text: string, w: string): string {
  const sentences = text.split(/(?<=[.!?۔])\s+/);
  const s = sentences.find((x) => has(x, w)) ?? text;
  return anonymise(s);
}

/**
 * Themes mentioned by at least one review, most mentioned first. Ratings
 * guard the sentiment: a positive word in a 1–2★ review ("not fresh") isn't
 * counted as praise, and a negative one in a 5★ review isn't a complaint.
 */
export function lexiconThemes(
  reviews: ReviewInput[],
  limit = 8,
): ReviewTheme[] {
  const out: ReviewTheme[] = [];
  for (const e of REVIEW_LEXICON) {
    const hits = reviews.filter((r) => {
      if (e.sentiment === 'positive' && r.rating <= 2) return false;
      if (e.sentiment === 'negative' && r.rating >= 5) return false;
      return e.words.some((w) => has(r.text, w));
    });
    if (!hits.length) continue;
    out.push({
      theme: e.theme,
      sentiment: e.sentiment,
      count: hits.length,
      examples: hits.slice(0, 2).map((r) =>
        snippet(
          r.text,
          e.words.find((w) => has(r.text, w))!,
        ),
      ),
    });
  }
  return out
    .sort((a, b) => b.count - a.count || (a.sentiment === 'negative' ? -1 : 1))
    .slice(0, limit);
}

/** "This week: 6 reviews mention cold food" — the top complaint, else the top praise. */
export function weeklyHeadline(themes: ReviewTheme[]): string | null {
  const top =
    themes.find((t) => t.sentiment === 'negative') ??
    themes.find((t) => t.sentiment === 'positive');
  if (!top) return null;
  return `This week: ${top.count} review${top.count === 1 ? '' : 's'} mention ${top.theme}`;
}
