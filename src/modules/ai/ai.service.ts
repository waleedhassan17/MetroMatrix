import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ClassConstructor, plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { createHash } from 'crypto';
import { DataSource } from 'typeorm';
import { AiFeature, AiSettings } from './ai-settings';
import { AiPart, AiProvider, AiProviderError } from './providers/ai-provider';
import { PromptRegistry } from './prompt-registry';
import { AiActor, AiQuotaService } from './ai-quota.service';
import { AiUsage, AiUsageStatus } from './entities/ai-usage.entity';
import { AiCacheEntry } from './entities/ai-cache.entity';
import { aiQuotaReached, aiUnavailable } from './ai-errors';
import { MediaStorage } from '../media/media-storage';

export interface AiCall<T extends object> {
  feature: AiFeature;
  promptId: string;
  /** Sent as JSON after the media parts. */
  input: Record<string, unknown>;
  media?: AiPart[];
  /** Gemini responseSchema (OpenAPI subset). */
  schema: Record<string, unknown>;
  /** class-validator DTO the answer must satisfy. */
  dto: ClassConstructor<T>;
  /** Extra semantic checks; any message fails validation (and triggers the retry). */
  check?: (out: T) => string[];
  actor: AiActor;
  /** Seconds to keep the answer when it isn't user-specific. */
  cacheSeconds?: number;
  audioSeconds?: number;
  temperature?: number;
}

export type AiFailure =
  'disabled' | 'unavailable' | 'quota' | 'timeout' | 'invalid' | 'error';

export type AiOutcome<T> =
  | { ok: true; data: T; cached: boolean }
  | {
      ok: false;
      reason: AiFailure;
      quota?: { key: string; limit: number; resetsOn: string };
    };

const flatten = (errors: ValidationError[], prefix = ''): string[] =>
  errors.flatMap((e) => {
    const path = prefix ? `${prefix}.${e.property}` : e.property;
    return [
      ...Object.values(e.constraints ?? {}).map((c) => `${path}: ${c}`),
      ...flatten(e.children ?? [], path),
    ];
  });

/**
 * The one door to the model. Every call: kill switch and feature flag →
 * cache → quota → the model within a 12 s budget → schema validation, one
 * retry that shows the model its errors → a usage row. Callers get an
 * outcome and choose their manual path on failure — AI never blocks
 * ordering.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly settings: AiSettings,
    private readonly provider: AiProvider,
    private readonly prompts: PromptRegistry,
    private readonly quota: AiQuotaService,
    private readonly storage: MediaStorage,
  ) {}

  /** A JSON answer from text input (the spec's json<T>). */
  json<T extends object>(
    call: Omit<AiCall<T>, 'media'>,
  ): Promise<AiOutcome<T>> {
    return this.run(call);
  }

  /**
   * A JSON answer about images (receipt scan, packing check, photo tips):
   * each image is read server-side (private ones through a signed link) and
   * sent inline. An image that can't be read is `unavailable`.
   */
  async vision<T extends object>(
    call: Omit<AiCall<T>, 'media'> & { imageUrls: string[]; maxBytes?: number },
  ): Promise<AiOutcome<T>> {
    if (!this.usable(call.feature))
      return {
        ok: false,
        reason: this.settings.isOn(call.feature) ? 'unavailable' : 'disabled',
      };
    const media: AiPart[] = [];
    for (const url of call.imageUrls) {
      const img = await this.storage.fetch(url, call.maxBytes ?? 8_000_000);
      if (!img || img === 'too_large')
        return { ok: false, reason: 'unavailable' };
      media.push({
        inline: { mimeType: img.mimeType, data: img.bytes.toString('base64') },
      });
    }
    return this.run({ ...call, media });
  }

  /** Is the feature usable at all (switches on, provider configured)? */
  usable(feature: AiFeature): boolean {
    return this.settings.isOn(feature) && this.provider.available();
  }

  /** The HTTP error for a failed outcome: 429 for quota, else 503 AI_UNAVAILABLE. */
  failure(
    outcome: Extract<AiOutcome<unknown>, { ok: false }>,
    manual: string,
  ): HttpException {
    if (outcome.reason === 'quota' && outcome.quota)
      return aiQuotaReached(
        outcome.quota.key,
        outcome.quota.limit,
        outcome.quota.resetsOn,
        manual,
      );
    return aiUnavailable(manual, outcome.reason);
  }

  async run<T extends object>(call: AiCall<T>): Promise<AiOutcome<T>> {
    if (!this.settings.isOn(call.feature))
      return { ok: false, reason: 'disabled' };
    if (!this.provider.available()) return { ok: false, reason: 'unavailable' };
    const prompt = this.prompts.get(call.promptId);
    const started = Date.now();

    const cacheKey = call.cacheSeconds
      ? createHash('sha256')
          .update(
            JSON.stringify([
              prompt.id,
              prompt.version,
              call.input,
              (call.media ?? []).map(partHash),
            ]),
          )
          .digest('hex')
      : null;
    if (cacheKey) {
      const hit = await this.dataSource.manager.findOne(AiCacheEntry, {
        where: { cacheKey },
      });
      if (hit && hit.expiresAt > new Date()) {
        const checked = await this.validateAnswer(call, hit.output);
        if (checked.ok) {
          await this.record(call, prompt.version, 'ok', {
            cached: true,
            started,
          });
          return { ok: true, data: checked.data, cached: true };
        }
      }
    }

    const refusal = await this.quota.refusal(
      call.actor,
      call.audioSeconds ?? 0,
    );
    if (refusal) {
      await this.record(call, prompt.version, 'quota', { started });
      return { ok: false, reason: 'quota', quota: refusal };
    }

    const deadline = started + this.settings.timeoutMs;
    let tokensIn = 0;
    let tokensOut = 0;
    let retryNote: string | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), remaining);
      try {
        const res = await this.provider.generate({
          system: prompt.text,
          parts: [
            ...(call.media ?? []),
            {
              text:
                JSON.stringify(call.input) +
                (retryNote
                  ? `\n\nYour previous answer was invalid: ${retryNote}. Answer again with valid JSON that fits the schema.`
                  : ''),
            },
          ],
          responseSchema: call.schema,
          temperature: call.temperature,
          signal: ctrl.signal,
        });
        tokensIn += res.tokensIn;
        tokensOut += res.tokensOut;
        let parsed: unknown;
        try {
          parsed = JSON.parse(res.text);
        } catch {
          retryNote = 'not JSON';
          continue;
        }
        const checked = await this.validateAnswer(call, parsed);
        if (!checked.ok) {
          retryNote = checked.errors.slice(0, 8).join('; ');
          continue;
        }
        await this.record(call, prompt.version, 'ok', {
          tokensIn,
          tokensOut,
          started,
        });
        if (cacheKey)
          await this.dataSource.query(
            `INSERT INTO ai_cache (cache_key, prompt_id, prompt_version, output, expires_at)
             VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))
             ON CONFLICT (cache_key) DO UPDATE SET output = EXCLUDED.output, expires_at = EXCLUDED.expires_at, updated_at = now()`,
            [
              cacheKey,
              prompt.id,
              prompt.version,
              JSON.stringify(parsed),
              call.cacheSeconds,
            ],
          );
        return { ok: true, data: checked.data, cached: false };
      } catch (err) {
        const kind = err instanceof AiProviderError ? err.kind : 'error';
        if (kind === 'timeout' || ctrl.signal.aborted) {
          await this.record(call, prompt.version, 'timeout', {
            tokensIn,
            tokensOut,
            started,
          });
          return { ok: false, reason: 'timeout' };
        }
        this.logger.warn(`${prompt.id}: ${(err as Error).message}`);
        await this.record(call, prompt.version, 'error', {
          tokensIn,
          tokensOut,
          started,
        });
        return { ok: false, reason: 'error' };
      } finally {
        clearTimeout(timer);
      }
    }
    const status: AiUsageStatus =
      Date.now() >= deadline && !retryNote ? 'timeout' : 'invalid';
    await this.record(call, prompt.version, status, {
      tokensIn,
      tokensOut,
      started,
    });
    return { ok: false, reason: status === 'timeout' ? 'timeout' : 'invalid' };
  }

  private validateAnswer<T extends object>(call: AiCall<T>, raw: unknown) {
    return checkAnswer(call.dto, raw, call.check);
  }

  private async record(
    call: AiCall<object>,
    version: number,
    status: AiUsageStatus,
    o: {
      tokensIn?: number;
      tokensOut?: number;
      cached?: boolean;
      started: number;
    },
  ) {
    try {
      await this.dataSource.manager.insert(AiUsage, {
        businessId: call.actor.businessId,
        userId: call.actor.userId || null,
        feature: call.feature,
        promptId: call.promptId,
        promptVersion: version,
        tokensIn: o.tokensIn ?? 0,
        tokensOut: o.tokensOut ?? 0,
        latencyMs: Date.now() - o.started,
        status,
        cached: o.cached ?? false,
        audioSeconds:
          status === 'quota' || o.cached
            ? 0
            : Math.ceil(call.audioSeconds ?? 0),
      });
    } catch (err) {
      this.logger.warn(`usage not recorded: ${(err as Error).message}`);
    }
  }
}

/** The model's JSON, as the DTO, or every reason it isn't one. */
export async function checkAnswer<T extends object>(
  dto: ClassConstructor<T>,
  raw: unknown,
  check?: (out: T) => string[],
): Promise<{ ok: true; data: T } | { ok: false; errors: string[] }> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return { ok: false, errors: ['not an object'] };
  const instance = plainToInstance(dto, raw);
  const errors = flatten(
    await validate(instance as object, {
      whitelist: true,
      forbidUnknownValues: false,
    }),
  );
  const extra = errors.length ? [] : (check?.(instance) ?? []);
  if (errors.length || extra.length)
    return { ok: false, errors: [...errors, ...extra] };
  return { ok: true, data: instance };
}

function partHash(p: AiPart): string {
  return 'text' in p
    ? p.text
    : createHash('sha256')
        .update(p.inline.mimeType)
        .update(p.inline.data)
        .digest('hex');
}
