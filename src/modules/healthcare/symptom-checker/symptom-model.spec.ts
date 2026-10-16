import { GeminiSymptomModel, parseSuggestion } from './symptom-model';
import { matchKeywords, keywordUrgency } from './keyword-matcher';

const SPECIALTIES = [
  { slug: 'general-physician', name: 'General Physician' },
  { slug: 'dermatologist', name: 'Dermatologist' },
  { slug: 'gastroenterologist', name: 'Gastroenterologist' },
];
const slugs = new Set(SPECIALTIES.map((s) => s.slug));
const input = { text: 'pimples on my face', age: 22, gender: 'female' };

const reply = (payload: unknown, status = 200) =>
  (async () =>
    ({
      ok: status < 400,
      status,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text:
                    typeof payload === 'string'
                      ? payload
                      : JSON.stringify(payload),
                },
              ],
            },
          },
        ],
      }),
    }) as Response) as unknown as typeof fetch;

describe('symptom model', () => {
  it('validates the answer against the live specialties', () => {
    expect(
      parseSuggestion(
        {
          specialtySlug: 'dermatologist',
          alternativeSlugs: ['dermatologist', 'nope', 'general-physician'],
          urgency: 'routine',
          advice: '  See a skin doctor.  ',
        },
        slugs,
      ),
    ).toEqual({
      specialtySlug: 'dermatologist',
      alternativeSlugs: ['general-physician'],
      urgency: 'routine',
      advice: 'See a skin doctor.',
    });
    expect(
      parseSuggestion(
        { specialtySlug: 'astrologer', urgency: 'routine', advice: 'x' },
        slugs,
      ),
    ).toBeNull();
    expect(
      parseSuggestion(
        { specialtySlug: 'dermatologist', urgency: 'now!', advice: 'x' },
        slugs,
      ),
    ).toBeNull();
    expect(parseSuggestion('nope', slugs)).toBeNull();
  });

  it('sends the key in a header (never the URL) and parses JSON mode output', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return reply({
        specialtySlug: 'dermatologist',
        urgency: 'routine',
        advice: 'Book a dermatologist.',
      })('', {});
    }) as unknown as typeof fetch;
    const m = new GeminiSymptomModel('k-123', 'gemini-2.5-flash', 1000, fake);
    expect(await m.suggest(input, SPECIALTIES)).toMatchObject({
      specialtySlug: 'dermatologist',
    });
    expect(seen!.url).not.toContain('k-123');
    expect(seen!.url).toContain('/models/gemini-2.5-flash:generateContent');
    expect(
      (seen!.init.headers as Record<string, string>)['x-goog-api-key'],
    ).toBe('k-123');
    const sent = JSON.parse(seen!.init.body as string);
    expect(sent.contents[0].parts[0].text).toContain('pimples on my face');
    expect(sent.generationConfig.responseMimeType).toBe('application/json');
  });

  it('returns null (→ fallback) without a key, on HTTP errors, bad JSON or a timeout', async () => {
    expect(
      await new GeminiSymptomModel('', 'm').suggest(input, SPECIALTIES),
    ).toBeNull();
    expect(
      await new GeminiSymptomModel('k', 'm', 1000, reply({}, 503)).suggest(
        input,
        SPECIALTIES,
      ),
    ).toBeNull();
    expect(
      await new GeminiSymptomModel('k', 'm', 1000, reply('not json')).suggest(
        input,
        SPECIALTIES,
      ),
    ).toBeNull();
    const hang = ((_: string, init: RequestInit) =>
      new Promise((_r, reject) =>
        init.signal!.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        ),
      )) as unknown as typeof fetch;
    expect(
      await new GeminiSymptomModel('k', 'm', 20, hang).suggest(
        input,
        SPECIALTIES,
      ),
    ).toBeNull();
  });
});

describe('keyword matcher', () => {
  const data = {
    specialties: [
      {
        id: 's1',
        slug: 'general-physician',
        name: 'General Physician',
        keywords: ['fever', 'bukhar', 'cough'],
      },
      {
        id: 's2',
        slug: 'dermatologist',
        name: 'Dermatologist',
        keywords: ['skin', 'rash', 'daane'],
      },
      {
        id: 's3',
        slug: 'gastroenterologist',
        name: 'Gastroenterologist',
        keywords: ['stomach', 'pait'],
      },
    ],
    conditions: [
      {
        id: 'c1',
        name: 'Acne',
        aliases: ['pimple', 'keel'],
        specialtySlug: 'dermatologist',
      },
      {
        id: 'c2',
        name: 'Acidity and heartburn',
        aliases: ['heartburn', 'tezabiat'],
        specialtySlug: 'gastroenterologist',
      },
    ],
  };

  it('scores conditions above keywords, whole words only, plurals allowed', () => {
    expect(
      matchKeywords('Pimples on my face and a little fever', data),
    ).toEqual({
      ranked: ['dermatologist', 'general-physician'],
      conditions: [{ id: 'c1', name: 'Acne' }],
    });
    expect(matchKeywords('tezabiat aur pait mein jalan', data).ranked[0]).toBe(
      'gastroenterologist',
    );
    // "skinny" is not "skin".
    expect(matchKeywords('I am skinny and tired', data).ranked).toEqual([]);
  });

  it('urgency is "soon" only on signs of severity', () => {
    expect(keywordUrgency('mild rash')).toBe('routine');
    expect(keywordUrgency('tez bukhar since yesterday')).toBe('soon');
    expect(keywordUrgency('Severe stomach pain')).toBe('soon');
  });
});
