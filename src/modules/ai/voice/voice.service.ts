import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import { ErrorCode } from '../../../common/errors/codes';
import { MediaService } from '../../media/media.service';
import { MediaStorage } from '../../media/media-storage';
import { UPLOAD_PURPOSES } from '../../media/asset-url';
import { AiService } from '../ai.service';
import { AiSettings } from '../ai-settings';
import { aiUnavailable } from '../ai-errors';
import { SpeechToText } from '../providers/speech';
import { VoiceLog, VoiceLogStatus } from '../entities/voice-log.entity';
import { parseVoiceText } from './rule-parser';
import { VoiceContexts } from './voice-contexts';
import {
  VOICE_INTENTS,
  VoiceContext,
  VoiceIntent,
  VoiceSlots,
} from './voice.types';
import {
  VOICE_MAX_SECONDS,
  VoiceAnswerDto,
  VoiceCommandDto,
} from './dto/voice.dto';
import { completeReading, sanitize, voiceSchema } from './reading';

/** Below this the reading is shown as "didn't catch that". */
export const MIN_CONFIDENCE = 0.5;
/** What a rule-parser reading is worth (it never guesses). */
const RULES_CONFIDENCE = 0.6;

const MANUAL =
  'Use the buttons on this screen, or type the command instead of speaking.';

export const voiceUnclear = (hint: string, transcript: string | null) =>
  new HttpException(
    {
      code: ErrorCode.VOICE_UNCLEAR,
      message: "Sorry, we didn't catch that.",
      details: { hint, transcript },
    },
    HttpStatus.UNPROCESSABLE_ENTITY,
  );

export const voiceTooLong = (detail: string) =>
  new BadRequestException({
    code: ErrorCode.VOICE_TOO_LONG,
    message: `Keep voice commands under ${VOICE_MAX_SECONDS} seconds.`,
    details: { maxSeconds: VOICE_MAX_SECONDS, detail },
  });

export interface Reading extends VoiceIntent {
  transcript: string;
  language: string;
  confidence: number;
  source: 'ai' | 'rules';
}

/**
 * POST /ai/voice: recording (or typed text) → transcript → intent → a
 * proposed action the app shows for confirmation. Nothing is executed here.
 * The model reads audio and intent in one call (STT_PROVIDER=gemini);
 * when its answer is unusable the deterministic rule parser reads the
 * transcript instead.
 */
@Injectable()
export class VoiceService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly ai: AiService,
    private readonly settings: AiSettings,
    private readonly contexts: VoiceContexts,
    private readonly media: MediaService,
    private readonly storage: MediaStorage,
    private readonly stt: SpeechToText,
  ) {}

  async command(user: AuthenticatedUser, dto: VoiceCommandDto) {
    const handler = this.contexts.get(dto.context);
    const { actor, scope, vocabulary } = await handler.authorize(user);
    const hint = dto.languageHint ?? 'auto';
    const audioSeconds = dto.audioUrl ? Math.ceil(dto.durationSeconds ?? 0) : 0;

    if (dto.audioUrl) {
      if ((dto.durationSeconds ?? 0) > VOICE_MAX_SECONDS)
        throw voiceTooLong(`${dto.durationSeconds} s`);
      this.media.assertOwnedAsset(
        user.id,
        'voice_audio',
        dto.audioUrl,
        dto.publicId,
        'audioUrl',
      );
    }

    const log = (
      status: VoiceLogStatus,
      r: Partial<Reading> = {},
    ): Promise<VoiceLog> =>
      this.dataSource.manager.save(
        this.dataSource.manager.create(VoiceLog, {
          businessId: actor.businessId,
          userId: actor.userId,
          context: dto.context,
          languageHint: hint,
          audioUrl: dto.audioUrl ?? null,
          audioSeconds,
          transcript: r.transcript ?? dto.text ?? null,
          language: r.language ?? null,
          intent: r.intent ?? null,
          slots: (r.slots as Record<string, unknown>) ?? null,
          confidence:
            r.confidence !== undefined ? r.confidence.toFixed(2) : null,
          source: r.source ?? null,
          status,
        }),
      );

    const input = voiceInput(dto.context, vocabulary, hint);
    const check = voiceCheck(dto.context);

    let reading: Reading | null = null;
    let transcript: string | null = dto.text ?? null;

    if (dto.audioUrl) {
      if (!this.ai.usable('voice')) {
        await log('unavailable');
        throw aiUnavailable(MANUAL, 'disabled');
      }
      const audio = await this.storage.fetch(
        dto.audioUrl,
        UPLOAD_PURPOSES.voice_audio.maxBytes,
      );
      if (audio === 'too_large') throw voiceTooLong('over 1 MB');
      if (!audio) {
        await log('unavailable');
        throw aiUnavailable(MANUAL, 'audio');
      }
      if (this.settings.sttProvider === 'google') {
        const ctrl = AbortSignal.timeout(this.settings.timeoutMs);
        const t = await this.stt.transcribe(
          audio.bytes,
          audio.mimeType,
          hint,
          ctrl,
        );
        transcript = t?.transcript || null;
        if (!transcript) {
          await log('unclear');
          throw voiceUnclear(handler.hint, null);
        }
      } else {
        const out = await this.ai.run({
          feature: 'voice',
          promptId: 'voice_intent',
          input,
          media: [
            {
              inline: {
                mimeType: audio.mimeType,
                data: audio.bytes.toString('base64'),
              },
            },
          ],
          schema: voiceSchema(dto.context),
          dto: VoiceAnswerDto,
          check,
          actor,
          audioSeconds,
          temperature: 0,
        });
        if (!out.ok) {
          if (out.reason === 'quota') throw this.ai.failure(out, MANUAL);
          await log('unavailable');
          throw this.ai.failure(out, MANUAL);
        }
        transcript = out.data.transcript?.trim() || null;
        reading = combineReadings(dto.context, out.data, transcript);
      }
    }

    if (!reading && transcript) {
      if (this.ai.usable('voice')) {
        const out = await this.ai.run({
          feature: 'voice',
          promptId: 'voice_intent',
          input: { ...input, text: transcript },
          schema: voiceSchema(dto.context),
          dto: VoiceAnswerDto,
          check,
          actor,
          audioSeconds,
          cacheSeconds: dto.audioUrl ? undefined : 24 * 3600,
          temperature: 0,
        });
        if (!out.ok && out.reason === 'quota')
          throw this.ai.failure(out, MANUAL);
        reading = combineReadings(
          dto.context,
          out.ok ? out.data : null,
          transcript,
        );
      } else reading = combineReadings(dto.context, null, transcript);
    }

    if (
      !reading ||
      reading.intent === 'unknown' ||
      reading.confidence < MIN_CONFIDENCE
    ) {
      await log('unclear', reading ?? { transcript: transcript ?? undefined });
      throw voiceUnclear(handler.hint, transcript);
    }

    const resolution = await handler.resolve(
      { intent: reading.intent, slots: reading.slots },
      scope,
      reading.transcript,
    );
    const row = await log('proposed', reading);
    return {
      voiceLogId: row.id,
      transcript: reading.transcript,
      language: reading.language,
      intent: reading.intent,
      slots: reading.slots,
      confidence: Number(reading.confidence.toFixed(2)),
      source: reading.source,
      proposedAction: resolution.proposedAction,
      ...(resolution.candidates ? { candidates: resolution.candidates } : {}),
      ...(resolution.draft !== undefined ? { draft: resolution.draft } : {}),
      ...(resolution.note ? { note: resolution.note } : {}),
      needsConfirmation: true,
    };
  }
}

/**
 * What the endpoint returns as the reading: the model's when it is sure
 * (completed by the rules where it left a slot empty), else the rules' when
 * they found a command in the words, else the unsure reading (→ unclear).
 * The eval script measures exactly this.
 */
export function combineReadings(
  context: VoiceContext,
  ai: Pick<
    VoiceAnswerDto,
    'intent' | 'slots' | 'confidence' | 'language'
  > | null,
  transcript: string | null,
): Reading | null {
  const words = transcript ?? '';
  const rules = words ? parseVoiceText(context, words) : null;
  const aiSure =
    ai && ai.intent !== 'unknown' && ai.confidence >= MIN_CONFIDENCE;
  if (aiSure) {
    const r = completeReading(
      { intent: ai.intent, slots: stripEmpty(ai.slots as VoiceSlots) },
      rules,
    );
    return {
      ...r,
      transcript: words,
      language: ai.language,
      confidence: ai.confidence,
      source: 'ai',
    };
  }
  if (rules && rules.intent !== 'unknown')
    return {
      ...sanitize(rules),
      transcript: words,
      language:
        ai?.language ?? (/[\u0600-\u06ff]/.test(words) ? 'ur' : 'unknown'),
      confidence: RULES_CONFIDENCE,
      source: 'rules',
    };
  if (ai)
    return {
      intent: ai.intent,
      slots: stripEmpty(ai.slots as VoiceSlots),
      transcript: words,
      language: ai.language,
      confidence: ai.confidence,
      source: 'ai',
    };
  return null;
}

/** What the model is given for a command (the eval script sends the same). */
export function voiceInput(
  context: VoiceContext,
  vocabulary: string[],
  hint: 'ur' | 'en' | 'auto',
  text?: string,
) {
  return {
    context,
    intents: VOICE_INTENTS[context],
    vocabulary: vocabulary.slice(0, 80),
    languageHint: hint,
    ...(text !== undefined ? { text } : {}),
  };
}

/** The model may only pick an intent this screen has. */
export const voiceCheck = (context: VoiceContext) => (a: VoiceAnswerDto) =>
  VOICE_INTENTS[context].includes(a.intent)
    ? []
    : [`intent must be one of ${VOICE_INTENTS[context].join(', ')}`];

export function stripEmpty(s: VoiceSlots): VoiceSlots {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s ?? {}))
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  return out as VoiceSlots;
}
