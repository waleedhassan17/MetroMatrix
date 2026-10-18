/** One piece of a request: text, or inline media (audio, an image) as base64. */
export type AiPart =
  { text: string } | { inline: { mimeType: string; data: string } };

export interface AiGenerateRequest {
  system: string;
  parts: AiPart[];
  /** Gemini's OpenAPI-subset schema; the provider asks for JSON that fits it. */
  responseSchema: Record<string, unknown>;
  temperature?: number;
  signal: AbortSignal;
}

export interface AiGenerateResponse {
  text: string;
  tokensIn: number;
  tokensOut: number;
  model: string;
}

export type AiProviderErrorKind =
  'timeout' | 'http' | 'empty' | 'blocked' | 'network';

export class AiProviderError extends Error {
  constructor(
    readonly kind: AiProviderErrorKind,
    message: string,
    /** HTTP status, and how long the provider asked us to wait (429). */
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

/**
 * The model behind every AI feature. Gemini in production; the e2e suite
 * overrides it with a scripted fake (test/utils/fake-ai.ts) — tests never
 * call a real model.
 */
export abstract class AiProvider {
  abstract readonly name: string;
  /** False without credentials: features take their manual path. */
  abstract available(): boolean;
  abstract generate(req: AiGenerateRequest): Promise<AiGenerateResponse>;
}
