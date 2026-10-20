/**
 * AI smoke: `npm run ai:smoke [-- --model m] [--only describe,receipt_scan] [--timeout ms]`.
 *
 * One real call for each assistant prompt, made as AiService.run makes it —
 * the prompt's text, the feature's response schema, the AI_TIMEOUT_MS budget
 * (12 s) and one retry carrying the validation errors — and checked by the
 * feature's own DTO and rules. Voice is measured by voice:eval instead.
 *
 * Images come from ai-smoke/ (git-ignored): receipt.jpg|png (a photographed
 * bill), packed.jpg and dish.jpg. Without dish/packed photos a credited demo
 * food photo (seeds/food/CREDITS.md) is downloaded once; without a receipt
 * photo that case is skipped. Answers are kept in ai-smoke/results.json and
 * the table is written into docs/AI.md. Calls the real model with
 * GEMINI_API_KEY from .env — never run it in CI or tests.
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import type { ClassConstructor } from 'class-transformer';
import { GeminiProvider } from '../modules/ai/providers/gemini.provider';
import { AiPart, AiProviderError } from '../modules/ai/providers/ai-provider';
import { PromptRegistry, PROMPTS_DIR } from '../modules/ai/prompt-registry';
import { checkAnswer } from '../modules/ai/ai.service';
import {
  COMBOS_SCHEMA,
  CombosAnswer,
  combosCheck,
  DESCRIBE_SCHEMA,
  DescribeAnswer,
  describeCheck,
  PHOTO_SCHEMA,
  PhotoTipsAnswer,
  SPECIALS_SCHEMA,
  SpecialsAnswer,
  specialsCheck,
} from '../modules/kitchen/assistant/menu-assistant.service';
import {
  decodeImage,
  measure,
  photoTips,
} from '../modules/kitchen/assistant/photo-metrics';
import {
  RECEIPT_SCHEMA,
  ReceiptAnswerDto,
} from '../modules/kitchen/purchases/receipt-scan.service';
import {
  PACKING_SCHEMA,
  PackingAnswerDto,
} from '../modules/kitchen/packing/packing.service';
import {
  THEMES_SCHEMA,
  ThemesAnswer,
  themesCheck,
} from '../modules/kitchen/reviews/review-insights.service';
import { anonymise } from '../modules/kitchen/reviews/review-lexicon';
import {
  ESTIMATE_SCHEMA,
  EstimateAnswer,
  estimateCheck,
} from '../modules/nutrition/item-nutrition.service';
import {
  pantryCheck,
  PantryRecipesAnswer,
  RECIPES_SCHEMA,
} from '../modules/my-kitchen/my-kitchen-recipes.service';
import { FOOD_PHOTOS } from '../database/seeds/food/food-data';

const ROOT = join(__dirname, '..', '..');
const DIR = join(ROOT, 'ai-smoke');
const RESULTS = join(DIR, 'results.json');
const DOC = join(ROOT, 'docs', 'AI.md');

const args = process.argv.slice(2);
const arg = (name: string) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const only = arg('--only')?.split(',');
const apiKey = process.env.GEMINI_API_KEY ?? '';
const model = arg('--model') || process.env.AI_MODEL || 'gemini-3.5-flash';
const timeoutMs = parseInt(
  arg('--timeout') || process.env.AI_TIMEOUT_MS || '12000',
  10,
);
const config = {
  get: (key: string, fallback?: unknown) =>
    ({ 'integrations.gemini.apiKey': apiKey, 'integrations.ai.model': model })[
      key
    ] ?? fallback,
} as unknown as ConfigService;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const day = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

type Media = { mimeType: string; data: string };
type Status = 'ok' | 'invalid' | 'timeout' | 'error' | 'skipped';
interface Case<T extends object = any> {
  promptId: string;
  feature: string;
  input: Record<string, unknown>;
  schema: Record<string, unknown>;
  dto: ClassConstructor<T>;
  check?: (a: T) => string[];
  temperature: number;
  image?: () => Promise<Media | string>;
  /** What came back, in a line. */
  summary: (a: T) => string;
}
interface Result {
  prompt: string;
  feature: string;
  status: Status;
  attempts: number;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  summary: string;
  answer?: unknown;
}

class QuotaStop extends Error {}

function mimeOf(bytes: Buffer): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes.subarray(0, 4).toString('hex') === '89504e47') return 'image/png';
  return null;
}

/** ai-smoke/<name>.jpg|jpeg|png, if someone put one there. */
function localImage(name: string): Buffer | null {
  for (const ext of ['jpg', 'jpeg', 'png']) {
    const f = join(DIR, `${name}.${ext}`);
    if (existsSync(f)) return readFileSync(f);
  }
  return null;
}

/** The demo biryani photo (Unsplash, credited in seeds/food/CREDITS.md), fetched once. */
async function demoPhoto(): Promise<Buffer> {
  const f = join(DIR, 'demo-biryani.jpg');
  if (!existsSync(f)) {
    const res = await fetch(
      `https://images.unsplash.com/${FOOD_PHOTOS.biryani}?w=800&h=800&fit=crop&q=80&fm=jpg`,
    );
    if (!res.ok) throw new Error(`demo photo: HTTP ${res.status}`);
    writeFileSync(f, Buffer.from(await res.arrayBuffer()));
  }
  return readFileSync(f);
}

const asMedia = (bytes: Buffer): Media | string => {
  const mimeType = mimeOf(bytes);
  return mimeType
    ? { mimeType, data: bytes.toString('base64') }
    : 'not a JPG or PNG';
};

function cases(dish: Buffer): Case[] {
  const ids = (names: string[]) =>
    names.map((name) => ({ id: randomUUID(), name }));
  const expiring = ids(['Tomato', 'Spinach (palak)', 'Yogurt']);
  const stocked = ids([
    'Chicken',
    'Onion',
    'Basmati rice',
    'Cooking oil',
    'Garam masala',
    'Ginger',
    'Green chilli',
  ]);
  const kitchen = new Set<string>([...expiring, ...stocked].map((i) => i.id));
  const expiringIds = new Set<string>(expiring.map((i) => i.id));
  const pantry = [
    ['Palak', 1],
    ['Paneer', 2],
    ['Doodh', 2],
    ['Aloo', 15],
    ['Pyaz', null],
    ['Anday', 9],
    ['Chawal', 120],
    ['Dahi', 3],
  ].map(([name, expiresInDays]) => ({
    id: randomUUID(),
    name,
    expiresInDays,
  }));
  const pantryIds = new Set(pantry.map((p) => p.id));
  const reviews = [
    [5, 'Biryani was full of flavour and the rice was perfect.'],
    [2, 'Fries were cold by the time they came. Call me on 0300 1234567.'],
    [4, 'Karahi was tasty but the delivery was late by 40 minutes.'],
    [5, 'Generous portion, the raita was fresh.'],
    [1, 'Cold fries again and the burger was soggy.'],
    [3, 'Good taste, packing leaked a bit.'],
    [4, 'Ayesha from the kitchen was very helpful on the phone.'],
    [2, 'Delivery late, food lukewarm.'],
  ].map(([rating, text]) => ({ rating, text: anonymise(text as string) }));
  const metrics = (() => {
    const img = decodeImage(dish);
    return img ? measure(img) : null;
  })();
  const all: Case[] = [
    {
      promptId: 'describe',
      feature: 'menu_assistant',
      input: {
        name: 'Chicken Karahi',
        nameUr: 'چکن کڑاہی',
        category: 'Karahi',
        cuisines: ['Pakistani', 'Desi'],
        sizes: ['Half', 'Full'],
        tags: ['spicy'],
        description: null,
        ingredients: ['Chicken', 'Cooking oil', 'Ginger', 'Green chilli'],
      },
      schema: DESCRIBE_SCHEMA,
      dto: DescribeAnswer,
      check: describeCheck,
      temperature: 0.6,
      summary: (a: DescribeAnswer) => `“${a.en}” / “${a.ur}”`,
    },
    {
      promptId: 'specials',
      feature: 'specials',
      input: {
        expiring: expiring.map((i, n) => ({
          ...i,
          onHand: ['4 kg', '2 kg', '3 kg'][n],
          expiresOn: day(n + 1),
        })),
        pantry: stocked,
        cuisines: ['Pakistani', 'Desi'],
        existingDishes: ['Chicken Karahi', 'Chicken Biryani', 'Daal Chawal'],
        targetFoodCostPct: 35,
      },
      schema: SPECIALS_SCHEMA,
      dto: SpecialsAnswer,
      check: specialsCheck,
      temperature: 0.7,
      // The service keeps an idea only on the kitchen's own ingredients, with one expiring.
      summary: (a: SpecialsAnswer) =>
        `${a.ideas.map((x) => x.name).join(', ')} — ${
          a.ideas.filter(
            (x) =>
              x.lines.every((l) => kitchen.has(l.ingredientId)) &&
              x.lines.some((l) => expiringIds.has(l.ingredientId)),
          ).length
        } of ${a.ideas.length} kept`,
    },
    {
      promptId: 'combos',
      feature: 'combos',
      input: {
        combos: [
          { key: 'Chicken Biryani|Raita', items: ['Chicken Biryani', 'Raita'] },
          { key: 'Chicken Karahi|Naan', items: ['Chicken Karahi', 'Naan'] },
        ],
        cuisines: ['Pakistani', 'Desi'],
      },
      schema: COMBOS_SCHEMA,
      dto: CombosAnswer,
      check: combosCheck,
      temperature: 0.7,
      summary: (a: CombosAnswer) => a.combos.map((c) => c.name).join(', '),
    },
    {
      promptId: 'photo_tips',
      feature: 'photo_check',
      input: {
        dish: 'Chicken Biryani',
        metrics,
        problems: metrics ? photoTips(metrics).problems : [],
      },
      schema: PHOTO_SCHEMA,
      dto: PhotoTipsAnswer,
      temperature: 0.3,
      image: async () => asMedia(dish),
      summary: (a: PhotoTipsAnswer) =>
        `food ${a.looksLikeFood}, matches ${a.matchesDish ?? '—'}; ${a.tips.join(' ')}`,
    },
    {
      promptId: 'receipt_scan',
      feature: 'receipt_scan',
      input: {
        ingredients: [
          'Basmati rice',
          'Chicken',
          'Cooking oil',
          'Green chilli',
          'Onion',
          'Tomato',
          'Yogurt',
        ],
      },
      schema: RECEIPT_SCHEMA,
      dto: ReceiptAnswerDto,
      temperature: 0,
      image: async () => {
        const bill = localImage('receipt');
        return bill ? asMedia(bill) : 'no ai-smoke/receipt.jpg|png';
      },
      summary: (a: ReceiptAnswerDto) =>
        `${a.lines.length} lines (${a.lines
          .map(
            (l) =>
              `${l.name} ${l.qty ?? '?'} ${l.unit ?? ''} Rs ${l.totalPrice ?? '?'}`,
          )
          .join('; ')}), total ${a.total ?? '—'}, confidence ${a.confidence}`,
    },
    {
      promptId: 'packing_check',
      feature: 'packing_check',
      input: {
        expectedItems: [
          { name: 'Chicken Biryani (Full)', quantity: 1 },
          { name: 'Raita', quantity: 1 },
        ],
      },
      schema: PACKING_SCHEMA,
      dto: PackingAnswerDto,
      temperature: 0,
      image: async () => asMedia(localImage('packed') ?? dish),
      summary: (a: PackingAnswerDto) =>
        `match ${a.match}, saw ${a.detectedItems.map((d) => `${d.name} ×${d.count}`).join(', ') || 'nothing'}; missing ${(a.missing ?? []).join(', ') || '—'}; confidence ${a.confidence}`,
    },
    {
      promptId: 'review_themes',
      feature: 'review_insights',
      input: { reviews },
      schema: THEMES_SCHEMA,
      dto: ThemesAnswer,
      check: themesCheck(reviews.length),
      temperature: 0.2,
      summary: (a: ThemesAnswer) =>
        a.themes
          .map((t) => `${t.theme} (${t.sentiment}, ${t.count})`)
          .join(', '),
    },
    {
      promptId: 'nutrition_estimate',
      feature: 'nutrition',
      input: {
        name: 'Chicken Karahi',
        description:
          'Chicken cooked fast in a wok with tomato, green chilli and ginger.',
        category: 'Karahi',
        serves: 2,
        sizes: ['Half', 'Full'],
        tags: ['spicy'],
        ingredients: [],
      },
      schema: ESTIMATE_SCHEMA,
      dto: EstimateAnswer,
      check: estimateCheck,
      temperature: 0.2,
      summary: (a: EstimateAnswer) =>
        `${a.servingGrams} g: ${a.kcal} kcal, protein ${a.proteinG} g, carbs ${a.carbsG} g, fat ${a.fatG} g; confidence ${a.confidence}`,
    },
    {
      promptId: 'pantry_recipes',
      feature: 'pantry_recipes',
      input: { pantry },
      schema: RECIPES_SCHEMA,
      dto: PantryRecipesAnswer,
      check: pantryCheck(pantryIds),
      temperature: 0.6,
      summary: (a: PantryRecipesAnswer) =>
        a.recipes
          .map(
            (r) =>
              `${r.title}${r.missing.length ? ` (needs ${r.missing.join(', ')})` : ''}`,
          )
          .join(', '),
    },
  ];
  return all;
}

/** One case, as AiService.run: a 12 s budget for both attempts, the retry carries the errors. */
async function run(
  provider: GeminiProvider,
  prompts: PromptRegistry,
  c: Case,
): Promise<Result> {
  const prompt = prompts.get(c.promptId);
  const base = {
    prompt: `${c.promptId}@${prompt.version}`,
    feature: c.feature,
  };
  let media: AiPart[] = [];
  if (c.image) {
    const img = await c.image();
    if (typeof img === 'string')
      return {
        ...base,
        status: 'skipped',
        attempts: 0,
        latencyMs: 0,
        tokensIn: 0,
        tokensOut: 0,
        summary: img,
      };
    media = [{ inline: img }];
  }
  for (let tries = 0; ; tries++) {
    const started = Date.now();
    const deadline = started + timeoutMs;
    let note: string | null = null;
    let tokensIn = 0;
    let tokensOut = 0;
    let attempts = 0;
    const done = (status: Status, summary: string, answer?: unknown) => ({
      ...base,
      status,
      attempts,
      latencyMs: Date.now() - started,
      tokensIn,
      tokensOut,
      summary,
      answer,
    });
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        attempts++;
        const res = await provider.generate({
          system: prompt.text,
          parts: [
            ...media,
            {
              text:
                JSON.stringify(c.input) +
                (note
                  ? `\n\nYour previous answer was invalid: ${note}. Answer again with valid JSON that fits the schema.`
                  : ''),
            },
          ],
          responseSchema: c.schema,
          temperature: c.temperature,
          signal: AbortSignal.timeout(remaining),
        });
        tokensIn += res.tokensIn;
        tokensOut += res.tokensOut;
        let raw: unknown;
        try {
          raw = JSON.parse(res.text);
        } catch {
          note = 'not JSON';
          continue;
        }
        const checked = await checkAnswer(c.dto, raw, c.check);
        if (!checked.ok) {
          note = checked.errors.slice(0, 8).join('; ');
          continue;
        }
        return done('ok', c.summary(checked.data), checked.data);
      }
      return note
        ? done('invalid', `invalid twice: ${note}`)
        : done('timeout', `over the ${timeoutMs / 1000} s budget`);
    } catch (err) {
      const e = err as AiProviderError;
      if (e.status === 429) {
        const wait = e.retryAfterMs ?? 30_000;
        if (wait > 60_000 || tries >= 2)
          throw new QuotaStop('the free tier’s daily limit for this model');
        process.stdout.write(` (429, waiting ${Math.ceil(wait / 1000)} s)`);
        await sleep(wait + 1000);
        continue;
      }
      return e.kind === 'timeout'
        ? done('timeout', `over the ${timeoutMs / 1000} s budget`)
        : done('error', e.message);
    }
  }
}

function table(results: Result[]): string {
  const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ');
  const cut = (s: string, n: number) =>
    s.length > n ? `${s.slice(0, n - 1)}…` : s;
  return [
    `Measured ${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })}: model ${model}, budget ${timeoutMs / 1000} s.`,
    '',
    '| Prompt | Feature | Result | Tries | Latency | Tokens in / out | What came back |',
    '|---|---|---|---|---|---|---|',
    ...results.map(
      (r) =>
        `| \`${r.prompt}\` | ${r.feature} | ${r.status} | ${r.attempts} | ${
          r.attempts ? `${(r.latencyMs / 1000).toFixed(1)} s` : '—'
        } | ${r.attempts ? `${r.tokensIn} / ${r.tokensOut}` : '—'} | ${cell(cut(r.summary, 160))} |`,
    ),
  ].join('\n');
}

async function main() {
  if (!apiKey) {
    console.error('GEMINI_API_KEY is not set (.env).');
    process.exit(1);
  }
  mkdirSync(DIR, { recursive: true });
  const prompts = new PromptRegistry();
  prompts.load(PROMPTS_DIR);
  const provider = new GeminiProvider(config);
  const dish = localImage('dish') ?? (await demoPhoto());
  const all = cases(dish);
  const results: Result[] = [];
  console.log(`AI smoke on ${model}`);
  try {
    for (const c of all.filter((x) => !only || only.includes(x.promptId))) {
      // ≤ 8 calls a minute for the free tier.
      if (results.some((r) => r.attempts)) await sleep(7_500);
      process.stdout.write(`${c.promptId}…`);
      const r = await run(provider, prompts, c);
      console.log(` ${r.status} (${(r.latencyMs / 1000).toFixed(1)} s)`);
      results.push(r);
    }
  } catch (err) {
    if (!(err instanceof QuotaStop)) throw err;
    console.log(`\nStopped at ${err.message}. Run again later.`);
  }
  // --only re-runs some rows: the others stay from the last run on this model and budget.
  const last = existsSync(RESULTS)
    ? JSON.parse(readFileSync(RESULTS, 'utf8'))
    : null;
  const idOf = (r: Result) => r.prompt.split('@')[0];
  const kept: Result[] =
    only && last?.model === model && last?.timeoutMs === timeoutMs
      ? last.results.filter(
          (r: Result) => !results.some((x) => idOf(x) === idOf(r)),
        )
      : [];
  const rank = (r: Result) => all.findIndex((c) => c.promptId === idOf(r));
  const merged = [...kept, ...results].sort((a, b) => rank(a) - rank(b));
  writeFileSync(
    RESULTS,
    JSON.stringify(
      { at: new Date().toISOString(), model, timeoutMs, results: merged },
      null,
      2,
    ),
  );
  const md = table(merged);
  console.log(`\n${md}\n`);
  const start = '<!-- ai-smoke:start -->';
  const end = '<!-- ai-smoke:end -->';
  const doc = readFileSync(DOC, 'utf8');
  if (merged.length && doc.includes(start) && doc.includes(end)) {
    writeFileSync(
      DOC,
      doc.slice(0, doc.indexOf(start) + start.length) +
        `\n${md}\n` +
        doc.slice(doc.indexOf(end)),
    );
    console.log('docs/AI.md updated.');
  }
  if (results.some((r) => r.status !== 'ok' && r.status !== 'skipped'))
    process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
