import { readFileSync } from 'fs';
import { join } from 'path';
import { parseVoiceText } from './rule-parser';
import { aliasMap, scoreReading } from './voice-score';
import { INGREDIENT_ALIASES } from '../../../database/migrations/1792362400000-KitchenAliasesSeed';

const ALIASES = aliasMap(INGREDIENT_ALIASES);
import { findNumbers, spokenMinutes, tokenize } from './lexicon';
import type { VoiceContext } from './voice.types';

const manifest = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', '..', '..', 'voice-eval', 'manifest.json'),
    'utf8',
  ),
) as {
  phrases: Array<{
    id: string;
    set: string;
    context: VoiceContext;
    text: string;
    expect: { intent: string; slots: Record<string, unknown> };
  }>;
};

const num = (s: string) => findNumbers(tokenize(s)).map((n) => n.value);

describe('lexicon numbers', () => {
  it.each([
    ['bees', [20]],
    ['baara sau', [1200]],
    ['ek hazaar do sau', [1200]],
    ['do hazaar ek sau', [2100]],
    ['chaar sau pachaas', [450]],
    ['dedh kilo', [1.5]],
    ['sawa do', [2.25]],
    ['sarhe teen', [3.5]],
    ['paune char', [3.75]],
    ['aadha', [0.5]],
    ['تین ہزار', [3000]],
    ['۲۰ منٹ', [20]],
    ['twelve dozen', [12]],
    ['5kilo', [5]],
  ])('%s → %j', (s, want) => expect(num(s)).toEqual(want));

  it('"do" after a verb is not 2', () => {
    expect(num('ready kar do')).toEqual([]);
    expect(num('de do')).toEqual([]);
    expect(num('do kilo aloo')).toEqual([2]);
  });

  it('minutes and hours', () => {
    expect(spokenMinutes(tokenize('bees minute'))).toBe(20);
    expect(spokenMinutes(tokenize('aadha ghanta'))).toBe(30);
    expect(spokenMinutes(tokenize('dedh ghanta'))).toBe(90);
    expect(spokenMinutes(tokenize('ek ghanta lagega'))).toBe(60);
    expect(spokenMinutes(tokenize('accept karo'))).toBeNull();
  });
});

describe('rule parser', () => {
  it('reads every tuning phrase of the voice accuracy set (regression gate)', () => {
    const misses = manifest.phrases
      .filter((p) => p.set === 'tuning')
      .map((p) => ({
        p,
        s: scoreReading(p.expect, parseVoiceText(p.context, p.text), ALIASES),
      }))
      .filter(({ s }) => !s.full)
      .map(({ p, s }) => `${p.id}: ${s.misses.join('; ')}`);
    expect(misses).toEqual([]);
  });

  it('reads at least 90% of the held-out phrases it was never tuned on', () => {
    const held = manifest.phrases.filter((p) => p.set === 'heldout');
    const ok = held.filter(
      (p) =>
        scoreReading(p.expect, parseVoiceText(p.context, p.text), ALIASES)
          .intent,
    ).length;
    expect(held.length).toBe(20);
    expect(ok / held.length).toBeGreaterThanOrEqual(0.9);
  });

  it('never guesses: chatter is unknown on every screen', () => {
    for (const c of [
      'board',
      'today',
      'stock',
      'purchase',
      'pantry',
    ] as VoiceContext[])
      expect(parseVoiceText(c, 'aaj mausam bohat acha hai').intent).toBe(
        'unknown',
      );
    expect(parseVoiceText('board', '').intent).toBe('unknown');
  });

  it('an explicit reject wins over a finished dish in the same sentence', () => {
    expect(
      parseVoiceText('board', 'reject kar do kyunke biryani khatam hai'),
    ).toEqual({ intent: 'reject', slots: { reason: 'biryani khatam hai' } });
  });

  it('order codes are read through spaces and dashes', () => {
    expect(parseVoiceText('board', 'fc 7kq2px accept').slots.orderCode).toBe(
      'FC-7KQ2PX',
    );
  });

  it('a price or expiry clause belongs to the line before it', () => {
    expect(
      parseVoiceText('purchase', 'paanch kilo tamatar, aath sau rupay'),
    ).toEqual({
      intent: 'add_purchase',
      slots: {
        lines: [{ name: 'tamatar', qty: 5, unit: 'kg', totalPrice: 800 }],
      },
    });
    expect(
      parseVoiceText('pantry', 'ek litre doodh, teen din mein expire'),
    ).toEqual({
      intent: 'add_pantry',
      slots: {
        lines: [{ name: 'doodh', qty: 1, unit: 'l', expiresInDays: 3 }],
      },
    });
  });
});
