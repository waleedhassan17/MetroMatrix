import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
  /** 'high' delivers immediately, waking the device. */
  priority?: 'default' | 'normal' | 'high';
}

/** One ticket per message, same order (https://docs.expo.dev/push-notifications/sending-notifications/). */
export interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

const EXPO_SEND_URL = 'https://exp.host/--/api/v2/push/send';
/** Expo accepts at most 100 messages per request. */
export const EXPO_BATCH_SIZE = 100;
const TIMEOUT_MS = 5000;

/**
 * Thin client for Expo's push API. Its own provider so tests replace it, and
 * so `enabled` (PUSH_ENABLED) is decided in one place: off in dev and tests,
 * on in production.
 */
@Injectable()
export class ExpoPushClient {
  private readonly logger = new Logger(ExpoPushClient.name);
  readonly enabled: boolean;
  private readonly accessToken: string;

  constructor(config: ConfigService) {
    this.enabled = config.get<boolean>('notifications.pushEnabled', false);
    this.accessToken = config.get<string>('notifications.expoAccessToken', '');
  }

  /** Sends one batch (≤ 100). Returns tickets aligned with `messages`. */
  async send(messages: ExpoMessage[]): Promise<ExpoTicket[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(EXPO_SEND_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(this.accessToken
            ? { Authorization: `Bearer ${this.accessToken}` }
            : {}),
        },
        body: JSON.stringify(messages),
        signal: controller.signal,
      });
      const json = (await res.json()) as { data?: ExpoTicket[] };
      if (!res.ok || !Array.isArray(json.data)) {
        this.logger.warn(`Expo push answered ${res.status}`);
        return [];
      }
      return json.data;
    } finally {
      clearTimeout(timer);
    }
  }
}
