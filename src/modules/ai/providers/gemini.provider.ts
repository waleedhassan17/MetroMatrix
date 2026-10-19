import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AiGenerateRequest,
  AiGenerateResponse,
  AiProvider,
  AiProviderError,
} from './ai-provider';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export function thinkingFor(model: string): Record<string, unknown> {
  const major = Number(/gemini-(\d+)/.exec(model)?.[1] ?? 0);
  if (major >= 3) return { thinkingConfig: { thinkingLevel: 'low' } };
  if (/flash/.test(model)) return { thinkingConfig: { thinkingBudget: 0 } };
  return {};
}

/**
 * Google Gemini over REST (the same call the symptom checker makes): a
 * system instruction, text and inline audio/image parts, and a JSON
 * response schema. Audio understanding covers Urdu and English.
 */
@Injectable()
export class GeminiProvider extends AiProvider {
  readonly name = 'gemini';
  private readonly logger = new Logger(GeminiProvider.name);
  private readonly apiKey: string;
  private readonly model: string;

  constructor(
    config: ConfigService,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    super();
    this.apiKey = config.get<string>('integrations.gemini.apiKey', '');
    this.model = config.get<string>(
      'integrations.ai.model',
      'gemini-3.5-flash',
    );
  }

  available(): boolean {
    return !!this.apiKey;
  }

  async generate(req: AiGenerateRequest): Promise<AiGenerateResponse> {
    const body = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [
        {
          role: 'user',
          parts: req.parts.map((p) =>
            'text' in p
              ? { text: p.text }
              : {
                  inlineData: {
                    mimeType: p.inline.mimeType,
                    data: p.inline.data,
                  },
                },
          ),
        },
      ],
      generationConfig: {
        temperature: req.temperature ?? 0.2,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        responseSchema: req.responseSchema,
        // Short, structured answers need little thinking: Gemini 2.x takes a
        // token budget, Gemini 3+ a level.
        ...thinkingFor(this.model),
      },
    };
    let res: Response;
    try {
      res = await this.fetchImpl(
        `${ENDPOINT}/${encodeURIComponent(this.model)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': this.apiKey,
          },
          body: JSON.stringify(body),
          signal: req.signal,
        },
      );
    } catch (err) {
      const name = (err as Error).name;
      if (name === 'AbortError' || name === 'TimeoutError')
        throw new AiProviderError('timeout', 'gemini timed out');
      throw new AiProviderError('network', `gemini: ${name}`);
    }
    if (!res.ok) {
      this.logger.warn(`gemini: HTTP ${res.status}`);
      let retryAfterMs: number | undefined;
      if (res.status === 429) {
        // RetryInfo.retryDelay ("37s"); the body is never logged.
        const delay = /"retryDelay":\s*"(\d+(?:\.\d+)?)s"/.exec(
          await res.text().catch(() => ''),
        );
        if (delay) retryAfterMs = Math.ceil(parseFloat(delay[1]) * 1000);
      }
      throw new AiProviderError(
        'http',
        `gemini HTTP ${res.status}`,
        res.status,
        retryAfterMs,
      );
    }
    const json = (await res.json()) as {
      candidates?: Array<{
        finishReason?: string;
        content?: { parts?: Array<{ text?: string }> };
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
      };
    };
    const cand = json.candidates?.[0];
    if (cand?.finishReason === 'SAFETY')
      throw new AiProviderError('blocked', 'gemini blocked the response');
    const text = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('');
    if (!text) throw new AiProviderError('empty', 'gemini returned nothing');
    return {
      text,
      tokensIn: json.usageMetadata?.promptTokenCount ?? 0,
      tokensOut: json.usageMetadata?.candidatesTokenCount ?? 0,
      model: this.model,
    };
  }
}
