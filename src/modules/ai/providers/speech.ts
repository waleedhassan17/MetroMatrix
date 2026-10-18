import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface Transcript {
  transcript: string;
  language: 'ur' | 'en' | 'mixed' | 'unknown';
  confidence: number;
}

/**
 * Speech-to-text when it isn't Gemini's (STT_PROVIDER=google). With the
 * default (gemini) the voice pipeline asks Gemini to transcribe and read the
 * intent in one call, and this provider is unused.
 */
export abstract class SpeechToText {
  abstract readonly name: 'gemini' | 'google';
  abstract transcribe(
    audio: Buffer,
    mimeType: string,
    hint: 'ur' | 'en' | 'auto',
    signal: AbortSignal,
  ): Promise<Transcript | null>;
}

export class GeminiCombinedSpeech extends SpeechToText {
  readonly name = 'gemini' as const;
  async transcribe(): Promise<Transcript | null> {
    return null;
  }
}

/** Google Cloud Speech-to-Text v1 (ur-PK with en-PK as an alternative). Off by default. */
@Injectable()
export class GoogleSpeechToText extends SpeechToText {
  readonly name = 'google' as const;
  private readonly logger = new Logger(GoogleSpeechToText.name);
  private readonly key: string;

  constructor(config: ConfigService) {
    super();
    this.key = config.get<string>('integrations.ai.googleCloudApiKey', '');
  }

  async transcribe(
    audio: Buffer,
    mimeType: string,
    hint: 'ur' | 'en' | 'auto',
    signal: AbortSignal,
  ): Promise<Transcript | null> {
    if (!this.key) return null;
    const primary = hint === 'en' ? 'en-PK' : 'ur-PK';
    const encoding = /webm/.test(mimeType)
      ? 'WEBM_OPUS'
      : /ogg/.test(mimeType)
        ? 'OGG_OPUS'
        : /mpeg/.test(mimeType)
          ? 'MP3'
          : undefined;
    try {
      const res = await fetch(
        `https://speech.googleapis.com/v1/speech:recognize?key=${encodeURIComponent(this.key)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            config: {
              languageCode: primary,
              alternativeLanguageCodes: [
                primary === 'ur-PK' ? 'en-PK' : 'ur-PK',
              ],
              enableAutomaticPunctuation: true,
              ...(encoding ? { encoding } : {}),
            },
            audio: { content: audio.toString('base64') },
          }),
          signal,
        },
      );
      if (!res.ok) {
        this.logger.warn(`stt: HTTP ${res.status}`);
        return null;
      }
      const json = (await res.json()) as {
        results?: Array<{
          languageCode?: string;
          alternatives?: Array<{ transcript?: string; confidence?: number }>;
        }>;
      };
      const parts = (json.results ?? [])
        .map((r) => r.alternatives?.[0])
        .filter(Boolean);
      const transcript = parts
        .map((a) => a!.transcript ?? '')
        .join(' ')
        .trim();
      const lang = json.results?.[0]?.languageCode?.startsWith('ur')
        ? 'ur'
        : json.results?.length
          ? 'en'
          : 'unknown';
      const confidence = parts.length
        ? parts.reduce((s, a) => s + (a!.confidence ?? 0), 0) / parts.length
        : 0;
      return { transcript, language: lang, confidence };
    } catch (err) {
      this.logger.warn(`stt: ${(err as Error).name}`);
      return null;
    }
  }
}

/**
 * Spoken announcements for devices without an Urdu voice (TTS_PROVIDER=google).
 * The default is none: the app speaks the announcement text on-device.
 */
export abstract class TextToSpeech {
  abstract readonly enabled: boolean;
  abstract synthesize(
    text: string,
    lang: 'ur' | 'en',
  ): Promise<{ audio: Buffer; mimeType: string } | null>;
}

export class NoTextToSpeech extends TextToSpeech {
  readonly enabled = false;
  async synthesize(): Promise<null> {
    return null;
  }
}

@Injectable()
export class GoogleTextToSpeech extends TextToSpeech {
  readonly enabled: boolean;
  private readonly logger = new Logger(GoogleTextToSpeech.name);
  private readonly key: string;

  constructor(config: ConfigService) {
    super();
    this.key = config.get<string>('integrations.ai.googleCloudApiKey', '');
    this.enabled = !!this.key;
  }

  async synthesize(text: string, lang: 'ur' | 'en') {
    if (!this.key) return null;
    try {
      const res = await fetch(
        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(this.key)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            input: { text },
            // Google offers Urdu voices under ur-IN; they read Pakistani Urdu fine.
            voice: { languageCode: lang === 'ur' ? 'ur-IN' : 'en-IN' },
            audioConfig: { audioEncoding: 'MP3' },
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!res.ok) {
        this.logger.warn(`tts: HTTP ${res.status}`);
        return null;
      }
      const json = (await res.json()) as { audioContent?: string };
      return json.audioContent
        ? {
            audio: Buffer.from(json.audioContent, 'base64'),
            mimeType: 'audio/mpeg',
          }
        : null;
    } catch (err) {
      this.logger.warn(`tts: ${(err as Error).name}`);
      return null;
    }
  }
}
