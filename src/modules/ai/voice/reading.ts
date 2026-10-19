import type {
  VoiceContext,
  VoiceIntent,
  VoiceLine,
  VoiceSlots,
} from './voice.types';
import { VOICE_INTENTS } from './voice.types';

/** The slots each intent may carry; anything else the model adds is dropped. */
export const INTENT_SLOTS: Record<string, Array<keyof VoiceSlots>> = {
  accept: ['orderCode', 'etaMinutes'],
  reject: ['orderCode', 'reason'],
  mark_ready: ['orderCode'],
  mark_unavailable: ['dish'],
  busy: ['minutes'],
  set_portions: ['dish', 'count'],
  cooking_today: ['on', 'dish'],
  add_purchase: ['lines'],
  log_waste: ['lines', 'reason'],
  count: ['lines'],
  search: ['query'],
  add_pantry: ['lines'],
  unknown: [],
};

/** The fields a line may carry, per intent. */
export const LINE_FIELDS: Record<string, Array<keyof VoiceLine>> = {
  add_purchase: ['name', 'qty', 'unit', 'totalPrice'],
  log_waste: ['name', 'qty', 'unit'],
  count: ['name', 'qty', 'unit'],
  add_pantry: ['name', 'qty', 'unit', 'expiresInDays'],
};

function pick<T extends object>(o: T, keys: Array<keyof T>): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys)
    if (o[k] !== undefined && o[k] !== null && o[k] !== '') out[k] = o[k];
  return out;
}

/** Only the slots (and line fields) this intent has. */
export function sanitize(r: VoiceIntent): VoiceIntent {
  const slots = pick(r.slots ?? {}, INTENT_SLOTS[r.intent] ?? []) as VoiceSlots;
  if (slots.lines) {
    const fields = LINE_FIELDS[r.intent] ?? ['name', 'qty', 'unit'];
    slots.lines = slots.lines
      .map((l) => pick(l, fields) as VoiceLine)
      .filter((l) => l.name);
    if (!slots.lines.length) delete slots.lines;
  }
  return { intent: r.intent, slots };
}

/**
 * The model's reading, completed by the rule parser where the model left a
 * slot empty and the rules read the same intent from the same words
 * ("aaj biryani ki bees plate": the model found the dish, the rules the 20).
 */
export function completeReading(
  ai: VoiceIntent,
  rules: VoiceIntent | null,
): VoiceIntent {
  const out = sanitize(ai);
  if (!rules || rules.intent !== out.intent) return out;
  const r = sanitize(rules);
  for (const k of INTENT_SLOTS[out.intent] ?? []) {
    if (k === 'lines') continue;
    if (out.slots[k] === undefined && r.slots[k] !== undefined)
      (out.slots as Record<string, unknown>)[k] = r.slots[k];
  }
  if (r.slots.lines && !out.slots.lines) out.slots.lines = r.slots.lines;
  else if (
    out.slots.lines &&
    r.slots.lines &&
    out.slots.lines.length === r.slots.lines.length
  )
    out.slots.lines = out.slots.lines.map((l, i) => ({
      ...r.slots.lines![i],
      ...l,
      name: l.name,
    }));
  return out;
}

const D = {
  orderCode: 'The order code if one was said, like FC-7KQ2PX.',
  etaMinutes:
    'Minutes until the order is ready or delivered, if said ("bees minute" = 20, "aadha ghanta" = 30).',
  reason: 'Why, in their words, if said.',
  dish: 'The dish, as on the menu (vocabulary) or as spoken.',
  count: 'How many portions or plates ("bees plate" = 20).',
  on: 'false for "not cooking", "chutti", "kitchen band"; true for cooking.',
  minutes: 'Extra minutes for busy mode ("pandrah minute" = 15).',
  query: 'What to search for, in a few words.',
  name: 'The item as spoken ("tamatar", "انڈے", "milk").',
  qty: 'The amount as a number ("dedh" = 1.5, "aadha" = 0.5).',
  totalPrice:
    'Rupees paid for this line ("aath sau rupay" = 800, "teen hazaar" = 3000).',
  expiresInDays: 'Days until it expires ("agle hafte" = 7, "teen din" = 3).',
};

/** Gemini responseSchema for voice_intent on one screen: only that screen's intents and slots. */
export function voiceSchema(context: VoiceContext): Record<string, unknown> {
  const intents = VOICE_INTENTS[context];
  const slotKeys = new Set(intents.flatMap((i) => INTENT_SLOTS[i] ?? []));
  const lineKeys = new Set(intents.flatMap((i) => LINE_FIELDS[i] ?? []));
  const props: Record<string, unknown> = {};
  const add = (k: keyof VoiceSlots, schema: Record<string, unknown>) => {
    if (slotKeys.has(k))
      props[k] = { ...schema, description: D[k as keyof typeof D] };
  };
  add('orderCode', { type: 'string' });
  add('etaMinutes', { type: 'integer' });
  add('reason', { type: 'string' });
  add('dish', { type: 'string' });
  add('count', { type: 'integer' });
  add('on', { type: 'boolean' });
  add('minutes', { type: 'integer' });
  add('query', { type: 'string' });
  if (slotKeys.has('lines')) {
    const line: Record<string, unknown> = {};
    if (lineKeys.has('name'))
      line.name = { type: 'string', description: D.name };
    if (lineKeys.has('qty')) line.qty = { type: 'number', description: D.qty };
    if (lineKeys.has('unit'))
      line.unit = {
        type: 'string',
        enum: ['kg', 'g', 'l', 'ml', 'dozen', 'piece', 'packet', 'tray'],
      };
    if (lineKeys.has('totalPrice'))
      line.totalPrice = { type: 'number', description: D.totalPrice };
    if (lineKeys.has('expiresInDays'))
      line.expiresInDays = { type: 'integer', description: D.expiresInDays };
    props.lines = {
      type: 'array',
      items: { type: 'object', properties: line, required: ['name'] },
    };
  }
  // Screens with log_waste have no reject: there the reason is a waste reason.
  if (intents.includes('log_waste'))
    props.reason = {
      type: 'string',
      enum: [
        'spoiled',
        'overcooked',
        'expired',
        'leftover',
        'returned',
        'other',
      ],
      description: 'Why it was thrown away.',
    };
  return {
    type: 'object',
    properties: {
      transcript: {
        type: 'string',
        description: 'With audio: exactly what was said, in the script spoken.',
      },
      language: { type: 'string', enum: ['ur', 'en', 'mixed', 'unknown'] },
      intent: { type: 'string', enum: [...intents] },
      slots: { type: 'object', properties: props },
      confidence: { type: 'number' },
    },
    // The transcript lets the rule parser fill a slot the model leaves empty.
    required: ['transcript', 'language', 'intent', 'slots', 'confidence'],
  };
}
