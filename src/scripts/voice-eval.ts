/**
 * Voice accuracy: `npm run voice:eval [-- --only rules|text|audio] [--model m] [--fresh]`.
 *
 * Reads voice-eval/manifest.json and measures three readers, each exactly as
 * POST /ai/voice reads (combineReadings: the model, completed by the rules):
 *  - rules: the deterministic parser on the written phrases (no network);
 *  - text:  the model (voice_intent prompt) on the written phrases;
 *  - audio: the model on spoken clips — real recordings from
 *           voice-eval/recordings/<id>.<ext> when present, else clips
 *           synthesised with Gemini TTS into voice-eval/clips/ (git-ignored).
 *
 * Results are kept in voice-eval/results.json per model and prompt version, so
 * a run stopped by the free tier's daily limit resumes where it stopped
 * (--fresh starts over). Writes the accuracy table into docs/VOICE.md.
 * `--clips-only` synthesises the missing clips without calling the model.
 * Audio alternates English and Urdu phrases, so a partial run stays balanced.
 * Calls the real model with GEMINI_API_KEY from .env — never run it in CI or
 * tests.
 */
import 'dotenv/config';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { GeminiProvider } from '../modules/ai/providers/gemini.provider';
import { AiProviderError } from '../modules/ai/providers/ai-provider';
import { PromptRegistry, PROMPTS_DIR } from '../modules/ai/prompt-registry';
import { checkAnswer } from '../modules/ai/ai.service';
import { parseVoiceText } from '../modules/ai/voice/rule-parser';
import {
  ExpectedReading,
  Score,
  aliasMap,
  scoreReading,
} from '../modules/ai/voice/voice-score';
import {
  combineReadings,
  voiceCheck,
  voiceInput,
} from '../modules/ai/voice/voice.service';
import { voiceSchema } from '../modules/ai/voice/reading';
import { VoiceAnswerDto } from '../modules/ai/voice/dto/voice.dto';
import type {
  VoiceContext,
  VoiceIntent,
} from '../modules/ai/voice/voice.types';
import { INGREDIENT_ALIASES } from '../database/migrations/1792362400000-KitchenAliasesSeed';

const ROOT = join(__dirname, '..', '..');
const EVAL = join(ROOT, 'voice-eval');
const CLIPS = join(EVAL, 'clips');
const RECORDINGS = join(EVAL, 'recordings');
const RESULTS = join(EVAL, 'results.json');
const DOC = join(ROOT, 'docs', 'VOICE.md');

interface Phrase {
  id: string;
  set: 'tuning' | 'heldout';
  lang: 'ur' | 'roman' | 'en';
  context: VoiceContext;
  text: string;
  expect: ExpectedReading;
}
interface Manifest {
  vocabulary: Record<string, string[]>;
  phrases: Phrase[];
}
type Reader = 'rules' | 'text' | 'audio';
interface Row {
  id: string;
  set: string;
  lang: string;
  reader: Reader;
  /** text | tts | recording */
  source: string;
  model: string;
  prompt: string;
  transcript?: string;
  reading: VoiceIntent | null;
  score: Score;
  error?: string;
}

const args = process.argv.slice(2);
const arg = (name: string) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const only = arg('--only') as Reader | undefined;
const fresh = args.includes('--fresh');
/** Only synthesise the missing clips (TTS quota is separate from the model's). */
const clipsOnly = args.includes('--clips-only');
const wants = (r: Reader) => !only || only === r;

const apiKey = process.env.GEMINI_API_KEY ?? '';
const model = arg('--model') || process.env.AI_MODEL || 'gemini-3.8-flash';
const ttsModel =
  arg('--tts-model') || process.env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-tts';
const ALIASES = aliasMap(INGREDIENT_ALIASES);
const MANIFEST: Manifest = JSON.parse(
  readFileSync(join(EVAL, 'manifest.json'), 'utf8'),
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const config = {
  get: (key: string, fallback?: unknown) =>
    ({ 'integrations.gemini.apiKey': apiKey, 'integrations.ai.model': model })[
      key
    ] ?? fallback,
} as unknown as ConfigService;

/** Spaced calls for the free tier: ≤ 8 per minute for the model, ≤ 3 for TTS. */
function pacer(gapMs: number) {
  let last = 0;
  return async () => {
    const wait = last + gapMs - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
  };
}
const modelTurn = pacer(7_500);
const ttsTurn = pacer(21_000);

class QuotaStop extends Error {}

/** Wait out a per-minute 429; stop on a per-day one. */
async function on429(retryAfterMs: number | undefined, tries: number) {
  const wait = retryAfterMs ?? 30_000;
  if (wait > 5 * 60_000 || tries >= 4)
    throw new QuotaStop('the free tier’s daily limit for this model');
  process.stdout.write(` (429, waiting ${Math.ceil(wait / 1000)} s)`);
  await sleep(wait + 1000);
}

/** One model call with validation and one retry (as AiService), then combineReadings. */
async function modelRead(
  provider: GeminiProvider,
  system: string,
  p: Phrase,
  media?: { mimeType: string; data: string },
): Promise<{
  reading: VoiceIntent | null;
  transcript?: string;
  error?: string;
}> {
  const hint = p.lang === 'en' ? 'en' : 'ur';
  const input = voiceInput(
    p.context,
    MANIFEST.vocabulary[p.context] ?? [],
    hint,
    media ? undefined : p.text,
  );
  let note = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    for (let tries = 0; ; tries++) {
      await modelTurn();
      try {
        const res = await provider.generate({
          system,
          parts: [
            ...(media ? [{ inline: media }] : []),
            {
              text:
                JSON.stringify(input) +
                (note
                  ? `\n\nYour previous answer was invalid: ${note}. Answer again with valid JSON that fits the schema.`
                  : ''),
            },
          ],
          responseSchema: voiceSchema(p.context),
          temperature: 0,
          signal: AbortSignal.timeout(30_000),
        });
        let raw: unknown;
        try {
          raw = JSON.parse(res.text);
        } catch {
          note = 'not JSON';
          break;
        }
        const checked = await checkAnswer(
          VoiceAnswerDto,
          raw,
          voiceCheck(p.context),
        );
        if (!checked.ok) {
          note = checked.errors.slice(0, 8).join('; ');
          break;
        }
        const transcript = media
          ? checked.data.transcript?.trim() || null
          : p.text;
        const r = combineReadings(p.context, checked.data, transcript);
        return {
          reading: r ? { intent: r.intent, slots: r.slots } : null,
          transcript: transcript ?? undefined,
        };
      } catch (err) {
        const e = err as AiProviderError;
        if (e.status === 429) {
          await on429(e.retryAfterMs, tries);
          continue;
        }
        return { reading: null, error: e.message };
      }
    }
  }
  return { reading: null, error: `invalid twice: ${note}` };
}

/** 16-bit mono PCM (Gemini TTS) → WAV. */
function wav(pcm: Buffer, rate: number): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const VOICES = ['Kore', 'Puck', 'Charon', 'Aoede', 'Fenrir', 'Leda'];

async function synthesize(p: Phrase, i: number): Promise<string> {
  const file = join(CLIPS, `${p.id}.wav`);
  if (existsSync(file)) return file;
  const say =
    p.lang === 'en'
      ? `Say this in a Pakistani English accent, like a busy restaurant owner talking to their phone: ${p.text}`
      : p.lang === 'roman'
        ? `This is Urdu written in Latin letters. Say it in natural spoken Urdu, the way a Pakistani kitchen owner talks to their phone: ${p.text}`
        : `Say this in natural spoken Urdu, the way a Pakistani kitchen owner talks to their phone: ${p.text}`;
  for (let tries = 0; ; tries++) {
    await ttsTurn();
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(ttsModel)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: say }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: VOICES[i % VOICES.length] },
              },
            },
          },
        }),
        signal: AbortSignal.timeout(90_000),
      },
    );
    if (res.status === 429) {
      const delay = /"retryDelay":\s*"(\d+(?:\.\d+)?)s"/.exec(await res.text());
      await on429(delay ? parseFloat(delay[1]) * 1000 : undefined, tries);
      continue;
    }
    if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
    const json = (await res.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ inlineData?: { mimeType: string; data: string } }>;
        };
      }>;
    };
    const part = json.candidates?.[0]?.content?.parts?.find(
      (x) => x.inlineData,
    )?.inlineData;
    if (!part) throw new Error('TTS returned no audio');
    const rate = Number(/rate=(\d+)/.exec(part.mimeType)?.[1] ?? 24000);
    writeFileSync(file, wav(Buffer.from(part.data, 'base64'), rate));
    return file;
  }
}

const AUDIO_MIME: Record<string, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  webm: 'audio/webm',
};

function recordingOf(id: string): string | null {
  if (!existsSync(RECORDINGS)) return null;
  const f = readdirSync(RECORDINGS).find((n) => n.startsWith(`${id}.`));
  return f ? join(RECORDINGS, f) : null;
}

function table(rows: Row[], promptLabel: string): string {
  const pct = (n: number, d: number) =>
    d ? `${Math.round((100 * n) / d)}% (${n}/${d})` : '—';
  const groups: Array<[string, (r: Row) => boolean]> = [
    ['Urdu script', (r) => r.lang === 'ur'],
    ['Roman Urdu', (r) => r.lang === 'roman'],
    ['English', (r) => r.lang === 'en'],
    ['All', () => true],
  ];
  const cols: Array<[string, Reader, string]> = [
    ['Rules, tuning (40)', 'rules', 'tuning'],
    ['Rules, held-out (20)', 'rules', 'heldout'],
    ['Model, text', 'text', 'all'],
    ['Model, audio', 'audio', 'all'],
  ];
  const lines = [
    `| Phrases | ${cols.map((c) => c[0]).join(' | ')} |`,
    `|---|${cols.map(() => '---').join('|')}|`,
  ];
  for (const metric of ['intent', 'full'] as const)
    for (const [name, f] of groups) {
      const cells = cols.map(([, reader, set]) => {
        const rs = rows.filter(
          (r) =>
            r.reader === reader && (set === 'all' || r.set === set) && f(r),
        );
        return pct(rs.filter((r) => r.score[metric]).length, rs.length);
      });
      lines.push(
        `| ${metric === 'intent' ? 'Intent' : 'Intent + slots'} — ${name} | ${cells.join(' | ')} |`,
      );
    }
  const audio = rows.filter((r) => r.reader === 'audio');
  const real = audio.filter((r) => r.source === 'recording').length;
  const text = rows.filter((r) => r.reader === 'text').length;
  return [
    `Measured ${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })}: model ${model}, ${promptLabel}; ` +
      `${text} of ${MANIFEST.phrases.length} phrases read as text, ${audio.length} as audio ` +
      `(${audio.length - real} clips synthesised with ${ttsModel}, ${real} real recordings).`,
    '',
    ...lines,
  ].join('\n');
}

/** English and Urdu (script or Roman) phrases alternated. */
function audioOrder(): Array<[number, Phrase]> {
  const all = [...MANIFEST.phrases.entries()];
  const en = all.filter(([, p]) => p.lang === 'en');
  const ur = all.filter(([, p]) => p.lang !== 'en');
  const out: Array<[number, Phrase]> = [];
  for (let i = 0; i < Math.max(en.length, ur.length); i++) {
    if (ur[i]) out.push(ur[i]);
    if (en[i]) out.push(en[i]);
  }
  return out;
}

async function main() {
  mkdirSync(CLIPS, { recursive: true });
  if (clipsOnly) {
    try {
      for (const [i, p] of audioOrder()) {
        if (recordingOf(p.id) || existsSync(join(CLIPS, `${p.id}.wav`)))
          continue;
        process.stdout.write(`clip ${p.id}…`);
        await synthesize(p, i);
        console.log(' ok');
      }
    } catch (err) {
      if (!(err instanceof QuotaStop)) throw err;
      console.log(`\nStopped at ${err.message}.`);
    }
    console.log(`${readdirSync(CLIPS).length} clips in voice-eval/clips.`);
    return;
  }
  const prompts = new PromptRegistry();
  prompts.load(PROMPTS_DIR);
  const prompt = prompts.get('voice_intent');
  const promptLabel = `voice_intent@${prompt.version}`;
  const previous: Row[] =
    !fresh && existsSync(RESULTS)
      ? JSON.parse(readFileSync(RESULTS, 'utf8')).rows
      : [];
  /** Earlier model results for this model and prompt version are kept (resume). */
  const rows: Row[] = previous.filter(
    (r) =>
      r.reader !== 'rules' &&
      r.model === model &&
      r.prompt === promptLabel &&
      !r.error,
  );
  const done = (reader: Reader, id: string) =>
    rows.some((r) => r.reader === reader && r.id === id);
  const save = () =>
    writeFileSync(
      RESULTS,
      JSON.stringify({ at: new Date().toISOString(), rows }, null, 2),
    );

  for (const p of MANIFEST.phrases) {
    const reading = parseVoiceText(p.context, p.text);
    rows.push({
      id: p.id,
      set: p.set,
      lang: p.lang,
      reader: 'rules',
      source: 'text',
      model: 'rules',
      prompt: '-',
      reading,
      score: scoreReading(p.expect, reading, ALIASES),
    });
  }

  if ((wants('text') || wants('audio')) && !apiKey)
    console.log('GEMINI_API_KEY is not set: only the rules were measured.');
  else if (wants('text') || wants('audio')) {
    const provider = new GeminiProvider(config);
    console.log(`${promptLabel} on ${model}`);
    const push = (
      p: Phrase,
      reader: Reader,
      source: string,
      r: Awaited<ReturnType<typeof modelRead>>,
    ) => {
      const score = scoreReading(p.expect, r.reading, ALIASES);
      rows.push({
        id: p.id,
        set: p.set,
        lang: p.lang,
        reader,
        source,
        model,
        prompt: promptLabel,
        transcript: r.transcript,
        reading: r.reading,
        score,
        ...(r.error ? { error: r.error } : {}),
      });
      save();
      const said = reader === 'audio' ? ` “${r.transcript ?? ''}”` : '';
      console.log(
        score.full
          ? ` ok${said}`
          : ` miss${said}: ${r.error ?? score.misses.join('; ')}`,
      );
    };
    try {
      if (wants('text'))
        for (const p of MANIFEST.phrases) {
          if (done('text', p.id)) continue;
          process.stdout.write(`text ${p.id}…`);
          push(p, 'text', 'text', await modelRead(provider, prompt.text, p));
        }
      if (wants('audio'))
        for (const [i, p] of audioOrder()) {
          if (done('audio', p.id)) continue;
          const rec = recordingOf(p.id);
          process.stdout.write(`audio ${p.id}${rec ? ' (recording)' : ''}…`);
          const file = rec ?? (await synthesize(p, i));
          const ext = file.split('.').pop()!.toLowerCase();
          push(
            p,
            'audio',
            rec ? 'recording' : 'tts',
            await modelRead(provider, prompt.text, p, {
              mimeType: AUDIO_MIME[ext] ?? 'audio/wav',
              data: readFileSync(file).toString('base64'),
            }),
          );
        }
    } catch (err) {
      if (!(err instanceof QuotaStop)) throw err;
      console.log(
        `\nStopped at ${err.message}. Results so far are kept; run again later to resume.`,
      );
    }
  }

  save();
  const md = table(rows, promptLabel);
  console.log(`\n${md}\n`);
  const start = '<!-- voice-eval:start -->';
  const end = '<!-- voice-eval:end -->';
  if (existsSync(DOC)) {
    const doc = readFileSync(DOC, 'utf8');
    if (doc.includes(start) && doc.includes(end)) {
      writeFileSync(
        DOC,
        doc.slice(0, doc.indexOf(start) + start.length) +
          `\n${md}\n` +
          doc.slice(doc.indexOf(end)),
      );
      console.log('docs/VOICE.md updated.');
    }
  }
  const misses = rows.filter((r) => !r.score.full);
  if (misses.length) {
    console.log('Misses:');
    for (const r of misses)
      console.log(
        `  ${r.reader} ${r.id}${r.transcript && r.reader === 'audio' ? ` “${r.transcript}”` : ''}: ${r.error ?? r.score.misses.join('; ')}`,
      );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
