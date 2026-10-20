import { DateTime } from 'luxon';
import { createTestApp, TestApp } from './utils/test-app';
import { enrolledAdmin } from './utils/admin';
import { Admin } from './utils/shopping';
import {
  Vendor,
  checkout,
  expectStatus,
  foodCustomer,
  foodVendor,
  itemId,
  setUpVendor,
} from './utils/food';
import {
  AiFakes,
  aiSettings,
  fakeAi,
  voiceClip,
  withFakeAi,
} from './utils/fake-ai';
import { AiJobsService } from '../src/modules/ai/ai-jobs.service';

/** Peshawar: only this suite puts vendors here. */
const PESHAWAR = { lat: 34.0151, lng: 71.5805 };

const answer = (
  intent: string,
  slots: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
) => ({ language: 'ur', intent, slots, confidence: 0.92, ...extra });

describe('AI foundation — voice, quotas, kill switch (Chunk 5 P0)', () => {
  let t: TestApp;
  let admin: Admin;
  let f: AiFakes;
  const sql = (q: string, p: unknown[] = []) => t.ds.query(q, p);

  beforeAll(async () => {
    f = fakeAi();
    t = await createTestApp({ override: withFakeAi(f) });
    admin = await enrolledAdmin(t);
  });
  afterAll(() => t.close());
  beforeEach(() => {
    f.ai.reset();
    const s = aiSettings(t);
    s.enabled = true;
    s.features = 'all';
    s.timeoutMs = 12_000;
  });

  async function liveVendor(name: string) {
    const v = await foodVendor(t, admin, 'restaurant', name);
    expect((await setUpVendor(t, v, { at: PESHAWAR }))!.status).toBe(200);
    const karahi = await itemId(t, v);
    return { v, karahi };
  }

  async function placed(v: Vendor, item: string) {
    const c = await foodCustomer(t, PESHAWAR);
    await expectStatus(
      await c.api.post('/food/cart/items', {
        vendorId: v.brandId,
        itemId: item,
        quantity: 2,
      }),
      201,
    );
    return expectStatus(await checkout(c), 201);
  }

  const voice = (v: { api: Vendor['api'] }, body: Record<string, unknown>) =>
    v.api.post('/ai/voice', body);

  it('a typed board command is read into a proposed accept — and nothing is executed', async () => {
    const { v, karahi } = await liveVendor('Voice Board Kitchen');
    const o = await placed(v, karahi);
    const eventsBefore = (
      await sql(
        `SELECT count(*)::int AS n FROM food_order_events WHERE order_id = $1`,
        [o.id],
      )
    )[0].n;
    f.ai.answer(answer('accept', { etaMinutes: 20 }));

    const out = await expectStatus(
      await voice(v, {
        context: 'board',
        text: 'order accept karo, bees minute',
      }),
      200,
    );
    expect(out).toMatchObject({
      intent: 'accept',
      slots: { etaMinutes: 20 },
      source: 'ai',
      needsConfirmation: true,
      proposedAction: {
        method: 'POST',
        path: `/food/vendor/orders/${o.id}/accept`,
        body: { etaMinutes: 20 },
      },
    });
    expect(out.proposedAction.summary).toContain(o.code);
    // The model saw the screen's intents and the order codes.
    const input = f.ai.lastInput();
    expect(input.context).toBe('board');
    expect(input.intents).toContain('accept');
    expect(input.vocabulary).toContain(o.code);

    // Nothing happened to the order.
    const [row] = await sql(`SELECT status FROM food_orders WHERE id = $1`, [
      o.id,
    ]);
    expect(row.status).toBe('placed');
    const eventsAfter = (
      await sql(
        `SELECT count(*)::int AS n FROM food_order_events WHERE order_id = $1`,
        [o.id],
      )
    )[0].n;
    expect(eventsAfter).toBe(eventsBefore);

    // Confirming = the app calls the proposed request itself.
    const p = out.proposedAction;
    await expectStatus(
      await v.api.post(p.path.replace(/^\/api\/v1/, ''), p.body),
      200,
    );
    const [after] = await sql(
      `SELECT status, eta_minutes FROM food_orders WHERE id = $1`,
      [o.id],
    );
    expect(after).toEqual({ status: 'accepted', eta_minutes: 20 });

    const [log] = await sql(
      `SELECT status, intent, source, audio_url FROM voice_logs WHERE id = $1`,
      [out.voiceLogId],
    );
    expect(log).toEqual({
      status: 'proposed',
      intent: 'accept',
      source: 'ai',
      audio_url: null,
    });
  });

  it('a recording is transcribed and read in one model call; usage counts its seconds', async () => {
    const { v, karahi } = await liveVendor('Voice Audio Kitchen');
    const clip = voiceClip(v.userId);
    f.storage.put(clip.url);
    f.ai.answer(
      answer(
        'mark_unavailable',
        { dish: 'karahi' },
        { transcript: 'karahi khatam ho gayi' },
      ),
    );
    const out = await expectStatus(
      await voice(v, {
        context: 'board',
        audioUrl: clip.url,
        publicId: clip.publicId,
        durationSeconds: 4.2,
        languageHint: 'ur',
      }),
      200,
    );
    expect(out).toMatchObject({
      transcript: 'karahi khatam ho gayi',
      intent: 'mark_unavailable',
      proposedAction: {
        method: 'PATCH',
        path: '/food/vendor/availability',
        body: { items: [{ itemId: karahi, isAvailable: false }] },
      },
    });
    // The audio went to the model inline.
    const media = f.ai.calls[0].parts.find((p) => 'inline' in p) as {
      inline: { mimeType: string; data: string };
    };
    expect(media.inline.mimeType).toBe('audio/mp4');
    expect(Buffer.from(media.inline.data, 'base64').toString()).toBe(
      'fake-audio',
    );

    const [usage] = await sql(
      `SELECT feature, prompt_id, prompt_version, status, audio_seconds, cached FROM ai_usage
        WHERE business_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [v.businessId],
    );
    expect(usage).toEqual({
      feature: 'voice',
      prompt_id: 'voice_intent',
      prompt_version: 3,
      status: 'ok',
      audio_seconds: 5,
      cached: false,
    });
    const me = await expectStatus(await v.api.get('/ai/usage'), 200);
    expect(me.aiActions.used).toBe(1);
    expect(me.voiceMinutes).toEqual({ used: 1, limit: 120 });
  });

  it('VOICE_TOO_LONG over 30 s or 1 MB; a URL that is not your upload is refused', async () => {
    const { v } = await liveVendor('Voice Limits Kitchen');
    const clip = voiceClip(v.userId);
    f.storage.put(clip.url);
    const long = await voice(v, {
      context: 'board',
      audioUrl: clip.url,
      durationSeconds: 45,
    });
    expect(long.status).toBe(400);
    expect(long.body.error.code).toBe('VOICE_TOO_LONG');

    const big = voiceClip(v.userId);
    f.storage.put(big.url, Buffer.alloc(1_000_001));
    const heavy = await voice(v, {
      context: 'board',
      audioUrl: big.url,
      durationSeconds: 10,
    });
    expect(heavy.status).toBe(400);
    expect(heavy.body.error.code).toBe('VOICE_TOO_LONG');

    const someoneElse = voiceClip('00000000-0000-4000-8000-000000000000');
    f.storage.put(someoneElse.url);
    const foreign = await voice(v, {
      context: 'board',
      audioUrl: someoneElse.url,
      durationSeconds: 3,
    });
    expect(foreign.status).toBe(400);
    expect(foreign.body.error.code).toBe('VALIDATION_FAILED');
    expect(f.ai.calls).toHaveLength(0);
  });

  it('an unsure or off-screen reading is 422 VOICE_UNCLEAR with a hint', async () => {
    const { v } = await liveVendor('Voice Unclear Kitchen');
    f.ai.answer(answer('unknown', {}, { confidence: 0.2 }));
    const res = await voice(v, {
      context: 'board',
      text: 'aaj mausam acha hai',
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VOICE_UNCLEAR');
    expect(res.body.error.details.hint).toMatch(/Try/);
    const [log] = await sql(
      `SELECT status FROM voice_logs WHERE business_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [v.businessId],
    );
    expect(log.status).toBe('unclear');
  });

  it('invalid model JSON is retried once with its errors, then the rule parser reads the words', async () => {
    const { v, karahi } = await liveVendor('Voice Fallback Kitchen');
    f.ai.answer('not json at all', answer('fly_to_moon'));
    const out = await expectStatus(
      await voice(v, {
        context: 'today',
        text: 'aaj chicken karahi ki bees plate',
      }),
      200,
    );
    expect(f.ai.calls).toHaveLength(2);
    expect(JSON.stringify(f.ai.calls[1].parts)).toContain(
      'Your previous answer was invalid',
    );
    expect(out).toMatchObject({
      intent: 'set_portions',
      source: 'rules',
      slots: { count: 20 },
      proposedAction: {
        method: 'PATCH',
        path: '/food/vendor/today',
        body: { items: [{ itemId: karahi, portions: 20 }] },
      },
    });
    const [usage] = await sql(
      `SELECT status FROM ai_usage WHERE business_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [v.businessId],
    );
    expect(usage.status).toBe('invalid');

    // Audio has no words to fall back on: 503 with the manual path.
    const clip = voiceClip(v.userId);
    f.storage.put(clip.url);
    f.ai.answer('nope', 'still nope');
    const res = await voice(v, {
      context: 'today',
      audioUrl: clip.url,
      durationSeconds: 3,
    });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({
      code: 'AI_UNAVAILABLE',
      details: { reason: 'invalid', manual: expect.any(String) },
    });
  });

  it('a slow model times out at the budget; typed commands still work through the rules', async () => {
    const { v } = await liveVendor('Voice Timeout Kitchen');
    aiSettings(t).timeoutMs = 150;
    f.ai.answer({ delayMs: 10_000 });
    const out = await expectStatus(
      await voice(v, {
        context: 'board',
        text: 'kitchen busy hai, pandrah minute',
      }),
      200,
    );
    expect(out).toMatchObject({
      intent: 'busy',
      source: 'rules',
      proposedAction: { path: '/food/vendor/busy', body: { extraMinutes: 15 } },
    });
    const [usage] = await sql(
      `SELECT status FROM ai_usage WHERE business_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [v.businessId],
    );
    expect(usage.status).toBe('timeout');
  });

  it('the same typed command is answered from the 24 h cache', async () => {
    const { v } = await liveVendor('Voice Cache Kitchen');
    f.ai.answer(answer('busy', { minutes: 10 }));
    const body = { context: 'board', text: 'thora rush hai das minute' };
    await expectStatus(await voice(v, body), 200);
    const again = await expectStatus(await voice(v, body), 200);
    expect(again.proposedAction.body).toEqual({ extraMinutes: 10 });
    expect(f.ai.calls).toHaveLength(1);
    const rows = await sql(
      `SELECT cached FROM ai_usage WHERE business_id = $1 ORDER BY created_at`,
      [v.businessId],
    );
    expect(rows.map((r: any) => r.cached)).toEqual([false, true]);
    // A cached answer costs nothing this month.
    const me = await expectStatus(await v.api.get('/ai/usage'), 200);
    expect(me.aiActions.used).toBe(1);
  });

  it('over the monthly allowance → 429 AI_QUOTA_REACHED with resetsOn (actions and voice minutes)', async () => {
    const { v } = await liveVendor('Voice Quota Kitchen');
    await expectStatus(
      await admin.api.patch(`/admin/food/vendors/${v.brandId}/plan`, {
        overrides: { limits: { ai_actions_month: 1, voice_minutes_month: 0 } },
      }),
      200,
    );
    const resetsOn = DateTime.now()
      .setZone('Asia/Karachi')
      .startOf('month')
      .plus({ months: 1 })
      .toISODate();

    const clip = voiceClip(v.userId);
    f.storage.put(clip.url);
    const minutes = await voice(v, {
      context: 'board',
      audioUrl: clip.url,
      durationSeconds: 5,
    });
    expect(minutes.status).toBe(429);
    expect(minutes.body.error).toMatchObject({
      code: 'AI_QUOTA_REACHED',
      details: { key: 'voice_minutes_month', limit: 0, resetsOn },
    });

    f.ai.answer(
      answer('busy', { minutes: 20 }),
      answer('busy', { minutes: 25 }),
    );
    await expectStatus(
      await voice(v, { context: 'board', text: 'busy bees minute' }),
      200,
    );
    const over = await voice(v, {
      context: 'board',
      text: 'busy pachees minute',
    });
    expect(over.status).toBe(429);
    expect(over.body.error).toMatchObject({
      code: 'AI_QUOTA_REACHED',
      details: { key: 'ai_actions_month', limit: 1, resetsOn },
    });
    expect(f.ai.calls).toHaveLength(1);
    const plan = await expectStatus(await v.api.get('/food/vendor/plan'), 200);
    expect(plan.limits.ai_actions_month).toBe(1);
    expect(plan.usage.ai_actions_month).toBe(1);
  });

  it('AI_ENABLED=false: recordings get 503 AI_UNAVAILABLE + manual path; typed commands use the rules; the model is never called', async () => {
    const { v, karahi } = await liveVendor('Voice Off Kitchen');
    const o = await placed(v, karahi);
    aiSettings(t).enabled = false;
    const clip = voiceClip(v.userId);
    f.storage.put(clip.url);
    const res = await voice(v, {
      context: 'board',
      audioUrl: clip.url,
      durationSeconds: 3,
    });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({
      code: 'AI_UNAVAILABLE',
      details: { reason: 'disabled', manual: expect.stringMatching(/buttons/) },
    });
    const typed = await expectStatus(
      await voice(v, { context: 'board', text: `${o.code} accept, 25 minute` }),
      200,
    );
    expect(typed).toMatchObject({
      intent: 'accept',
      source: 'rules',
      proposedAction: {
        path: `/food/vendor/orders/${o.id}/accept`,
        body: { etaMinutes: 25 },
      },
    });
    // The feature list switches one feature off the same way.
    aiSettings(t).enabled = true;
    aiSettings(t).features = new Set(['menu_assistant']);
    const off = await voice(v, {
      context: 'board',
      audioUrl: clip.url,
      durationSeconds: 3,
    });
    expect(off.status).toBe(503);
    expect(f.ai.calls).toHaveLength(0);
    const usage = await expectStatus(await v.api.get('/ai/usage'), 200);
    expect(usage.enabled).toBe(true);
  });

  it('dish names resolve in Urdu script; an ambiguous name returns candidates instead of an action', async () => {
    const { v } = await liveVendor('Voice Names Kitchen');
    const cats = await expectStatus(
      await v.api.get('/food/vendor/menu/categories'),
      200,
    );
    const mk = (name: string, nameUr?: string) =>
      v.api.post('/food/vendor/menu/items', {
        categoryId: cats[0].id,
        name,
        ...(nameUr ? { nameUr } : {}),
        basePrice: 900,
      });
    const biryani = await expectStatus(
      await mk('Chicken Biryani', 'چکن بریانی'),
      201,
    );
    expect(biryani.nameUr).toBe('چکن بریانی');
    await expectStatus(await mk('Beef Biryani'), 201);

    f.ai.answer(answer('set_portions', { dish: 'چکن بریانی', count: 30 }));
    const ur = await expectStatus(
      await voice(v, { context: 'today', text: 'آج چکن بریانی کی تیس پلیٹیں' }),
      200,
    );
    expect(ur.proposedAction.body).toEqual({
      items: [{ itemId: biryani.id, portions: 30 }],
    });

    f.ai.answer(answer('mark_unavailable', { dish: 'biryani' }));
    const amb = await expectStatus(
      await voice(v, { context: 'board', text: 'biryani khatam' }),
      200,
    );
    expect(amb.proposedAction).toBeNull();
    expect(amb.note).toBe('Which dish?');
    expect(amb.candidates.map((c: any) => c.label).sort()).toEqual([
      'Beef Biryani',
      'Chicken Biryani',
    ]);
  });

  it('customers speak a food search; vendor screens are refused to them and customer screens to vendors', async () => {
    const { v } = await liveVendor('Voice Roles Kitchen');
    const c = await foodCustomer(t, PESHAWAR);
    f.ai.answer(answer('search', { query: 'biryani' }));
    const out = await expectStatus(
      await voice(c, { context: 'food_search', text: 'mujhe biryani chahiye' }),
      200,
    );
    expect(out.proposedAction).toMatchObject({
      method: 'GET',
      path: '/food/search?q=biryani',
    });

    const board = await voice(c, { context: 'board', text: 'accept' });
    expect(board.status).toBe(403);
    const search = await voice(v, { context: 'food_search', text: 'biryani' });
    expect(search.status).toBe(403);
    // The pantry screen arrived with My Kitchen (P11): customers only.
    const pantry = await expectStatus(
      await voice(c, { context: 'pantry', text: 'do kilo aloo' }),
      200,
    );
    expect(pantry).toMatchObject({
      intent: 'add_pantry',
      proposedAction: { path: '/my-kitchen/pantry/batch' },
    });
    expect(
      (await voice(v, { context: 'pantry', text: 'do kilo aloo' })).status,
    ).toBe(403);
  });

  it('GET /ai/announce reads a new order aloud (Urdu, Roman Urdu, English); another vendor’s order is 404', async () => {
    const { v, karahi } = await liveVendor('Voice Announce Kitchen');
    const other = await liveVendor('Voice Announce Other');
    await expectStatus(
      await v.api.patch(`/food/vendor/menu/items/${karahi}`, {
        nameUr: 'چکن کڑاہی',
      }),
      200,
    );
    const o = await placed(v, karahi);
    const spelled = o.code.replace('FC-', '').split('').join(' ');
    const [{ total }] = await sql(
      `SELECT total FROM food_orders WHERE id = $1`,
      [o.id],
    );
    const ur = await expectStatus(
      await v.api.get(`/ai/announce?orderId=${o.id}`),
      200,
    );
    expect(ur).toMatchObject({ code: o.code, lang: 'ur', ttsUrl: null });
    expect(ur.text).toContain('نیا آرڈر: دو چکن کڑاہی، ڈیلیوری، کیش۔');
    expect(ur.text).toContain(spelled);
    const en = await expectStatus(
      await v.api.get(`/ai/announce?orderId=${o.id}&lang=en`),
      200,
    );
    expect(en.text).toBe(
      `New order: two Chicken Karahi, delivery, cash. Total ${total.toLocaleString('en-PK')} rupees. Order ${spelled}.`,
    );
    const roman = await expectStatus(
      await v.api.get(`/ai/announce?orderId=${o.id}&lang=roman`),
      200,
    );
    expect(roman.text).toMatch(
      /^Naya order: do Chicken Karahi, delivery, cash\./,
    );
    const res = await other.v.api.get(`/ai/announce?orderId=${o.id}`);
    expect(res.status).toBe(404);
  });

  it('retention: audio deleted after 24 h, transcripts after 30 days, expired cache purged — and a second run finds nothing', async () => {
    const { v } = await liveVendor('Voice Retention Kitchen');
    const clip = voiceClip(v.userId);
    f.storage.put(clip.url);
    f.ai.answer(
      answer('busy', { minutes: 10 }, { transcript: 'busy das minute' }),
    );
    const out = await expectStatus(
      await voice(v, {
        context: 'board',
        audioUrl: clip.url,
        durationSeconds: 2,
      }),
      200,
    );
    const jobs = t.app.get(AiJobsService);
    const now = new Date();
    await sql(
      `UPDATE voice_logs SET created_at = now() - interval '25 hours' WHERE id = $1`,
      [out.voiceLogId],
    );
    await sql(
      `INSERT INTO ai_cache (cache_key, prompt_id, prompt_version, output, expires_at)
       VALUES ('expired-test-key', 'voice_intent', 1, '{}', now() - interval '1 minute')`,
    );
    const first = (await jobs.retention(now)) as Record<string, number>;
    expect(first.audioDeleted).toBeGreaterThanOrEqual(1);
    expect(f.storage.destroyed).toContain(clip.url);
    const [row] = await sql(
      `SELECT audio_url, audio_deleted_at, transcript FROM voice_logs WHERE id = $1`,
      [out.voiceLogId],
    );
    expect(row.audio_url).toBeNull();
    expect(row.audio_deleted_at).not.toBeNull();
    expect(row.transcript).toBe('busy das minute');
    expect(
      (
        await sql(
          `SELECT count(*)::int AS n FROM ai_cache WHERE cache_key = 'expired-test-key'`,
        )
      )[0].n,
    ).toBe(0);

    const second = (await jobs.retention(now)) as Record<string, number>;
    expect(f.storage.destroyed.filter((u) => u === clip.url)).toHaveLength(1);
    expect(second.audioFailed).toBe(0);

    await sql(
      `UPDATE voice_logs SET created_at = now() - interval '31 days' WHERE id = $1`,
      [out.voiceLogId],
    );
    await jobs.retention(now);
    expect(
      (
        await sql(`SELECT count(*)::int AS n FROM voice_logs WHERE id = $1`, [
          out.voiceLogId,
        ])
      )[0].n,
    ).toBe(0);
  });
});
