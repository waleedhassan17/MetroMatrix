import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';

export const VOICE_CONTEXTS = [
  'board',
  'today',
  'stock',
  'purchase',
  'menu_search',
  'food_search',
  'pantry',
] as const;
export type VoiceContext = (typeof VOICE_CONTEXTS)[number];

/** The intents each screen understands (`unknown` = couldn't tell). */
export const VOICE_INTENTS: Record<VoiceContext, readonly string[]> = {
  board: [
    'accept',
    'reject',
    'mark_ready',
    'mark_unavailable',
    'busy',
    'unknown',
  ],
  today: ['set_portions', 'cooking_today', 'unknown'],
  stock: ['count', 'log_waste', 'add_purchase', 'unknown'],
  purchase: ['add_purchase', 'log_waste', 'unknown'],
  menu_search: ['search', 'unknown'],
  food_search: ['search', 'unknown'],
  pantry: ['add_pantry', 'unknown'],
};

export interface VoiceLine {
  /** As spoken ("tamatar"); the server maps it to an ingredient. */
  name: string;
  qty?: number;
  unit?: string;
  totalPrice?: number;
  expiresInDays?: number;
}

export interface VoiceSlots {
  orderCode?: string;
  etaMinutes?: number;
  reason?: string;
  dish?: string;
  count?: number;
  on?: boolean;
  minutes?: number;
  lines?: VoiceLine[];
  query?: string;
}

export interface VoiceIntent {
  intent: string;
  slots: VoiceSlots;
}

/** What the app should call when the person confirms. Nothing is executed by /ai/voice. */
export interface ProposedAction {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT';
  path: string;
  body?: Record<string, unknown>;
  /** "Accept FC-7KQ2PX, ready in 20 minutes". */
  summary: string;
}

export interface VoiceActor {
  userId: string;
  businessId: string | null;
}

export interface Resolution {
  proposedAction: ProposedAction | null;
  /** When a name or order was ambiguous: the choices. */
  candidates?: Array<{ id: string; label: string; score?: number }>;
  /** Lines the app shows for confirmation (purchases, pantry). */
  draft?: unknown;
  /** Why nothing could be proposed ("Which order?"). */
  note?: string;
}

/**
 * A screen that takes voice. Registered by the module that owns the screen
 * (kitchen, my-kitchen) so the AI module never depends on Food.
 */
export interface VoiceContextHandler<S = unknown> {
  context: VoiceContext;
  /** Throws 403 when this user can't use this screen; returns their scope and the names worth hinting. */
  authorize(
    user: AuthenticatedUser,
  ): Promise<{ actor: VoiceActor; scope: S; vocabulary: string[] }>;
  resolve(
    intent: VoiceIntent,
    scope: S,
    transcript: string,
  ): Promise<Resolution>;
  /** "Try: 'accept order, 20 minutes'" */
  hint: string;
}
