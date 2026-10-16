import { Logger } from '@nestjs/common';

export const URGENCIES = ['routine', 'soon', 'urgent'] as const;
export type Urgency = (typeof URGENCIES)[number];

export interface SymptomInput {
  text: string;
  age: number | null;
  gender: string | null;
}

export interface ModelSuggestion {
  specialtySlug: string;
  alternativeSlugs: string[];
  urgency: Urgency;
  advice: string;
}

/**
 * The optional language model behind the symptom checker. Returns null when
 * it has no usable answer (no key, timeout, error, or output that fails
 * validation) — the caller then falls back to the keyword matcher. Tests
 * replace it with a fake.
 */
export abstract class SymptomModel {
  abstract readonly enabled: boolean;
  abstract suggest(
    input: SymptomInput,
    specialties: Array<{ slug: string; name: string }>,
  ): Promise<ModelSuggestion | null>;
}

/** Validates the model's JSON against the live specialty list; null if anything is off. */
export function parseSuggestion(
  raw: unknown,
  slugs: Set<string>,
): ModelSuggestion | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.specialtySlug !== 'string' || !slugs.has(r.specialtySlug))
    return null;
  if (!URGENCIES.includes(r.urgency as Urgency)) return null;
  if (typeof r.advice !== 'string' || !r.advice.trim()) return null;
  const alts = Array.isArray(r.alternativeSlugs) ? r.alternativeSlugs : [];
  return {
    specialtySlug: r.specialtySlug,
    alternativeSlugs: [
      ...new Set(
        alts.filter(
          (s): s is string =>
            typeof s === 'string' && slugs.has(s) && s !== r.specialtySlug,
        ),
      ),
    ].slice(0, 2),
    urgency: r.urgency as Urgency,
    advice: r.advice.trim().slice(0, 400),
  };
}

const SYSTEM_PROMPT = `You help patients in Pakistan choose which kind of doctor to see.
You are not diagnosing. Never name a medicine or a dose. Never say a condition is certain.
Pick exactly one specialty slug from the list for the person's symptoms, up to two alternatives,
and an urgency: "routine" (book in the coming days), "soon" (see a doctor within 24 hours)
or "urgent" (seek care today). Advice: one or two plain sentences on what to do next,
in the same language the person wrote in (English or Roman Urdu).
Answer only with JSON matching the schema.`;

/**
 * Google Gemini (generateContent, JSON mode). Sends only the symptom text,
 * age and gender — never the person's name, account or contact details.
 * The key travels in the x-goog-api-key header, not the URL.
 */
export class GeminiSymptomModel extends SymptomModel {
  private readonly logger = new Logger(GeminiSymptomModel.name);

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly timeoutMs = 8000,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    super();
  }

  get enabled() {
    return !!this.apiKey;
  }

  async suggest(
    input: SymptomInput,
    specialties: Array<{ slug: string; name: string }>,
  ): Promise<ModelSuggestion | null> {
    if (!this.apiKey) return null;
    const slugs = specialties.map((s) => s.slug);
    const body = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: [
                `Specialties (slug: name): ${specialties.map((s) => `${s.slug}: ${s.name}`).join('; ')}`,
                `Age: ${input.age ?? 'unknown'}; gender: ${input.gender ?? 'unknown'}`,
                `Symptoms: ${input.text}`,
              ].join('\n'),
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 400,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            specialtySlug: { type: 'STRING', enum: slugs },
            alternativeSlugs: {
              type: 'ARRAY',
              items: { type: 'STRING', enum: slugs },
            },
            urgency: { type: 'STRING', enum: [...URGENCIES] },
            advice: { type: 'STRING' },
          },
          required: ['specialtySlug', 'urgency', 'advice'],
        },
      },
    };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': this.apiKey,
          },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        },
      );
      if (!res.ok) {
        this.logger.warn(`gemini: HTTP ${res.status}`);
        return null;
      }
      const json = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) return null;
      return parseSuggestion(JSON.parse(text), new Set(slugs));
    } catch (err) {
      this.logger.warn(`gemini: ${(err as Error).name}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
