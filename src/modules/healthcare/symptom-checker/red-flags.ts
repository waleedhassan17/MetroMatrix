/**
 * Deterministic emergency rules, checked before anything else — a hit never
 * reaches the model. English and Roman Urdu (as people type it on phones,
 * with the common spelling variants). Patterns run on normalised text:
 * lower case, punctuation → spaces, single spaces.
 *
 * Kept deliberately specific: "heartburn" is not chest pain, "breathing
 * exercise" is not breathlessness. False negatives are covered by the
 * disclaimer and the advice to call for help; false positives by a clear
 * "if this isn't an emergency, describe it differently" note.
 */
export interface RedFlagRule {
  id: string;
  label: string;
  patterns: RegExp[];
}

const W = (s: string) => new RegExp(`(?:^| )(?:${s})(?= |$)`);

export const RED_FLAGS: RedFlagRule[] = [
  {
    id: 'chest_pain',
    label: 'Chest pain or pressure',
    patterns: [
      W(
        'chest (?:pain|pressure|tightness|hurts|is hurting)|pain in (?:my |the )?chest|crushing chest',
      ),
      W(
        '(?:seene|seeney|seenay|sine|sinay) (?:mein|mai|me|main|par) (?:dard|dabao|bhari pan|jalan)',
      ),
      W('dil (?:mein|mai|me|main|ka) (?:dard|daura)|heart attack'),
    ],
  },
  {
    id: 'breathing',
    label: 'Severe difficulty breathing',
    patterns: [
      W(
        "can ?not breathe|can'?t breathe|unable to breathe|difficulty breathing|struggling to breathe|short(?:ness)? of breath|gasping for (?:air|breath)",
      ),
      W(
        'saa?ns? (?:nahi|nai|nhi|ni) (?:aa|a) (?:rahi|rha|raha|rhi)|saa?ns? lene (?:mein|mai|me|main) (?:mushkil|takleef|dikkat)|saa?ns? (?:phool|ruk) (?:rahi|raha|rhi|gayi|gaya)',
      ),
      W('(?:lips|face) (?:turning )?blue|honth neele'),
    ],
  },
  {
    id: 'stroke',
    label: 'Signs of a stroke',
    patterns: [
      W(
        'face (?:is )?droop(?:ing)?|slurred speech|sudden (?:weakness|numbness)|one side (?:of (?:my|the|his|her) body )?(?:is )?(?:weak|numb|paralysed|paralyzed)|stroke',
      ),
      W(
        'lakwa|lakhwa|falij|faalij|zaban (?:larkhara|larakh|lark)|munh tera|chehra tera',
      ),
    ],
  },
  {
    id: 'unconscious',
    label: 'Unconscious, fainting or a seizure',
    patterns: [
      W(
        'unconscious|passed out|not responding|unresponsive|fainted|seizures?|convulsions?',
      ),
      W(
        'behosh|be hosh|hosh (?:nahi|nai|nhi) (?:aa|a)|daura (?:para|pada|par gaya)|mirgi ka daura|jhatke',
      ),
    ],
  },
  {
    id: 'bleeding',
    label: 'Heavy or uncontrolled bleeding',
    patterns: [
      W(
        "heavy bleeding|bleeding (?:heavily|a lot|won'?t stop|will not stop|does not stop|doesn'?t stop)|vomiting blood|coughing (?:up )?blood|blood in vomit",
      ),
      W(
        'khoon (?:nahi|nai|nhi) (?:ruk|rukh) (?:raha|rha|rahi)|bohat (?:zyada |ziada )?khoon|khoon ki (?:ulti|ultiyan)|khoon (?:thook|thuk)',
      ),
    ],
  },
  {
    id: 'self_harm',
    label: 'Thoughts of suicide or self-harm',
    patterns: [
      W(
        'suicid\\w*|kill (?:my ?self|myself)|end my life|end it all|want to die|self ?harm|hurt myself',
      ),
      W(
        'khud ?kushi|khudkushi|apni jaan (?:lena|le lun|dena)|marna chahta|marna chahti|jeena nahi chahta|jeena nahi chahti',
      ),
    ],
  },
  {
    id: 'poisoning',
    label: 'Poisoning or overdose',
    patterns: [
      W(
        'poison(?:ed|ing)?|overdose|swallowed (?:bleach|acid|pills|tablets)|took too many (?:pills|tablets)',
      ),
      W('zeher|zehar|zahar|zehr|bohat saari goliyan|ziada goliyan'),
    ],
  },
  {
    id: 'anaphylaxis',
    label: 'Severe allergic reaction',
    patterns: [
      W(
        'throat (?:is )?(?:swelling|closing|closed)|swollen (?:tongue|throat)|anaphyla\\w*|tongue (?:is )?swelling',
      ),
      W('gala band|gala sooj|zaban sooj|honth sooj'),
    ],
  },
  {
    id: 'meningitis',
    label: 'Fever with a stiff neck or a non-fading rash',
    patterns: [
      W(
        "stiff neck (?:and|with) (?:a )?(?:high )?fever|(?:high )?fever (?:and|with) (?:a )?stiff neck|rash that (?:does not|doesn'?t) fade",
      ),
      W(
        'gardan (?:akar|akri|akad|sakht) (?:aur|or|ke sath) (?:tez )?bukhar|(?:tez )?bukhar (?:aur|or|ke sath) gardan (?:akar|akri|akad|sakht)',
      ),
    ],
  },
  {
    id: 'pregnancy',
    label: 'Bleeding or severe pain in pregnancy',
    patterns: [
      W(
        'pregnan\\w* (?:and |with )?(?:heavy )?(?:bleeding|severe pain)|bleeding (?:while|during) pregnan\\w*',
      ),
      W(
        '(?:hamal|hamla|pregnancy) (?:mein|mai|me|main) (?:khoon|shadeed dard)',
      ),
    ],
  },
  {
    id: 'injury',
    label: 'Serious injury',
    patterns: [
      W(
        'head injury|hit (?:my|his|her) head|severe burn\\w*|road accident|car accident|bike accident|broken bone sticking|gunshot|stabbed',
      ),
      W(
        'sar (?:par|pe|mein) (?:chot|zakhm)|accident ho gaya|jal (?:gaya|gayi|gaye) (?:hai|hain)|goli lagi',
      ),
    ],
  },
];

export const normalise = (text: string) =>
  text
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Every red flag the text raises (empty = none). */
export function redFlags(text: string): Array<{ id: string; label: string }> {
  const t = normalise(text);
  return RED_FLAGS.filter((r) => r.patterns.some((p) => p.test(t))).map(
    (r) => ({ id: r.id, label: r.label }),
  );
}

/**
 * Who to call. Rescue 1122 is the provincial emergency and ambulance
 * service (coverage varies by area); Edhi's 115 ambulance line is reachable
 * across Pakistan. Checked October 2026 — see docs/API_HEALTH.md.
 */
export const EMERGENCY_CONTACTS = [
  { number: '1122', label: 'Rescue 1122 — emergency & ambulance' },
  { number: '115', label: 'Edhi ambulance' },
];
