import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const AI_FEATURES = [
  'voice',
  'menu_assistant',
  'specials',
  'combos',
  'photo_check',
  'receipt_scan',
  'packing_check',
  'review_insights',
  'nutrition',
  'pantry_recipes',
] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

/**
 * The kill switch (AI_ENABLED) and the per-feature list (AI_FEATURES), read
 * once at boot. Mutable so the e2e suite can flip them without a restart.
 */
@Injectable()
export class AiSettings {
  enabled: boolean;
  features: Set<string> | 'all';
  timeoutMs: number;
  sttProvider: 'gemini' | 'google';
  ttsProvider: 'none' | 'google';

  constructor(config: ConfigService) {
    const ai = config.get<{
      enabled: boolean;
      features: string[];
      timeoutMs: number;
      sttProvider: 'gemini' | 'google';
      ttsProvider: 'none' | 'google';
    }>('integrations.ai');
    this.enabled = ai?.enabled ?? false;
    const list = ai?.features ?? ['all'];
    this.features = list.includes('all') ? 'all' : new Set(list);
    this.timeoutMs = ai?.timeoutMs ?? 12_000;
    this.sttProvider = ai?.sttProvider ?? 'gemini';
    this.ttsProvider = ai?.ttsProvider ?? 'none';
  }

  isOn(feature: AiFeature): boolean {
    return (
      this.enabled && (this.features === 'all' || this.features.has(feature))
    );
  }
}
