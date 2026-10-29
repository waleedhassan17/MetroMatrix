/**
 * The platform's server-side switches (FinMatrix-style flags). This file is
 * the ONLY place a setting is defined: its type, default, limits and label.
 * GET/PATCH /admin/settings validate against it, GET /config publishes the
 * public part, and PlatformGuard enforces it.
 */
export type SettingType = 'boolean' | 'string' | 'email';

export interface SettingSpec {
  type: SettingType;
  default: boolean | string;
  group: 'signups' | 'services' | 'ai' | 'maintenance' | 'support';
  label: string;
  description: string;
  /** Strings only. */
  maxLength?: number;
  allowEmpty?: boolean;
}

export const PLATFORM_SETTINGS = {
  'signupsEnabled.customer': {
    type: 'boolean',
    default: true,
    group: 'signups',
    label: 'Customer sign-ups',
    description: 'New customer accounts (email and Google).',
  },
  'signupsEnabled.partner': {
    type: 'boolean',
    default: true,
    group: 'signups',
    label: 'Partner sign-ups',
    description: 'New partner accounts (stores, doctors, kitchens).',
  },
  'services.shopping.enabled': {
    type: 'boolean',
    default: true,
    group: 'services',
    label: 'Shopping',
    description: 'Off: customer and partner Shopping routes answer 503.',
  },
  'services.healthcare.enabled': {
    type: 'boolean',
    default: true,
    group: 'services',
    label: 'Healthcare',
    description: 'Off: patient and doctor routes answer 503.',
  },
  'services.food.enabled': {
    type: 'boolean',
    default: true,
    group: 'services',
    label: 'Food',
    description:
      'Off: every Food route (customers, vendors, riders) answers 503.',
  },
  'services.kitchen.enabled': {
    type: 'boolean',
    default: true,
    group: 'services',
    label: 'Kitchen',
    description:
      'Off: the vendor kitchen console, Bachat Box, nutrition and My Kitchen answer 503.',
  },
  'ai.enabled': {
    type: 'boolean',
    default: true,
    group: 'ai',
    label: 'AI features',
    description:
      'Off: every AI feature falls back to its manual path (the server’s AI_ENABLED must also be on).',
  },
  'maintenance.enabled': {
    type: 'boolean',
    default: false,
    group: 'maintenance',
    label: 'Maintenance mode',
    description:
      'On: the apps show the maintenance screen; only admins and /config keep working.',
  },
  'maintenance.message': {
    type: 'string',
    default:
      'MetroMatrix is down for scheduled maintenance. Please try again shortly.',
    group: 'maintenance',
    label: 'Maintenance message',
    description: 'Shown on the maintenance screen.',
    maxLength: 280,
    allowEmpty: false,
  },
  'support.email': {
    type: 'email',
    default: '',
    group: 'support',
    label: 'Support email',
    description: 'Shown in the apps. Empty hides it.',
    maxLength: 254,
    allowEmpty: true,
  },
} as const satisfies Record<string, SettingSpec>;

export type SettingKey = keyof typeof PLATFORM_SETTINGS;
export type SettingsValues = { [K in SettingKey]: boolean | string };

export const SETTING_KEYS = Object.keys(PLATFORM_SETTINGS) as SettingKey[];

export const isSettingKey = (key: string): key is SettingKey =>
  Object.prototype.hasOwnProperty.call(PLATFORM_SETTINGS, key);

export const DEFAULT_SETTINGS = Object.fromEntries(
  SETTING_KEYS.map((k) => [k, PLATFORM_SETTINGS[k].default]),
) as SettingsValues;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** The stored form of `value` for `key`, or why it is not acceptable. */
export function checkSetting(
  key: SettingKey,
  value: unknown,
): { ok: true; value: boolean | string } | { ok: false; problem: string } {
  const spec: SettingSpec = PLATFORM_SETTINGS[key];
  if (spec.type === 'boolean') {
    return typeof value === 'boolean'
      ? { ok: true, value }
      : { ok: false, problem: 'must be true or false' };
  }
  if (typeof value !== 'string') {
    return { ok: false, problem: 'must be text' };
  }
  const text = value.trim();
  if (!text && !spec.allowEmpty) return { ok: false, problem: 'is required' };
  if (spec.maxLength && text.length > spec.maxLength) {
    return {
      ok: false,
      problem: `must be at most ${spec.maxLength} characters`,
    };
  }
  if (spec.type === 'email' && text && !EMAIL.test(text)) {
    return { ok: false, problem: 'must be an email address' };
  }
  return { ok: true, value: text };
}

/** For GET /admin/meta and GET /admin/settings. */
export function settingsSchema() {
  return SETTING_KEYS.map((key) => ({ key, ...PLATFORM_SETTINGS[key] }));
}

/** What GET /config publishes to the apps. */
export function publicConfig(v: SettingsValues) {
  return {
    signupsEnabled: {
      customer: v['signupsEnabled.customer'] as boolean,
      partner: v['signupsEnabled.partner'] as boolean,
    },
    services: {
      shopping: { enabled: v['services.shopping.enabled'] as boolean },
      healthcare: { enabled: v['services.healthcare.enabled'] as boolean },
      food: { enabled: v['services.food.enabled'] as boolean },
      kitchen: { enabled: v['services.kitchen.enabled'] as boolean },
    },
    ai: { enabled: v['ai.enabled'] as boolean },
    maintenance: {
      enabled: v['maintenance.enabled'] as boolean,
      message: v['maintenance.message'] as string,
    },
    support: { email: (v['support.email'] as string) || null },
  };
}
