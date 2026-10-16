import { normalise, redFlags } from './red-flags';

const ids = (text: string) => redFlags(text).map((f) => f.id);

describe('symptom red flags', () => {
  it.each([
    ['I have crushing chest pain going down my left arm', 'chest_pain'],
    ['seene mein dard ho raha hai', 'chest_pain'],
    ['Abbu ko dil ka daura para lagta hai', 'chest_pain'],
    ["My son can't breathe properly", 'breathing'],
    ['saans nahi aa rahi', 'breathing'],
    ['saans lene mein takleef hai', 'breathing'],
    ['Her face is drooping and she has slurred speech', 'stroke'],
    ['ammi ko lakwa ho gaya', 'stroke'],
    ['He fainted and is not responding', 'unconscious'],
    ['bacha behosh ho gaya', 'unconscious'],
    ["The bleeding won't stop", 'bleeding'],
    ['khoon nahi ruk raha', 'bleeding'],
    ['I want to end my life', 'self_harm'],
    ['khudkushi ka soch raha hoon', 'self_harm'],
    ['My child swallowed bleach', 'poisoning'],
    ['zehar kha liya', 'poisoning'],
    ['My throat is closing after eating peanuts', 'anaphylaxis'],
    ['High fever with stiff neck since morning', 'meningitis'],
    ['tez bukhar aur gardan akar gayi', 'meningitis'],
    ['I am pregnant with heavy bleeding', 'pregnancy'],
    ['He hit his head in a bike accident', 'injury'],
    ['My 2 month old baby has a high fever', 'infant_fever'],
    ['chhota bacha hai aur tez bukhar hai', 'infant_fever'],
  ])('%s → %s', (text, id) => {
    expect(ids(text)).toContain(id);
  });

  it.each([
    'I get heartburn after spicy food',
    'Doing breathing exercises for anxiety',
    'pimples on my face for 6 months',
    'Dry cough and mild fever for two days',
    'knee pain when climbing stairs',
    'sar dard aur nazla',
    'The weekend my back started hurting',
  ])('no flag: %s', (text) => {
    expect(ids(text)).toEqual([]);
  });

  it('any fever under age 1 is a red flag; the same text at 30 is not', () => {
    expect(redFlags('fever since last night', 0).map((f) => f.id)).toEqual([
      'infant_fever',
    ]);
    expect(redFlags('fever since last night', 30)).toEqual([]);
  });

  it('normalises punctuation, case and spacing (Urdu script survives)', () => {
    expect(normalise('  CHEST-pain!!  Since\nmorning… ')).toBe(
      'chest pain since morning',
    );
    expect(normalise('سینے میں درد')).toBe('سینے میں درد');
  });
});
