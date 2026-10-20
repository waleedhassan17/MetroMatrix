# Voice commands — MetroMatrix Kitchen (Chunk 5)

Vendors run a busy kitchen with wet hands. They press the mic, say "order accept karo, bees
minute", and the app shows what it understood before anything happens. Customers can speak
a food search, and what they put in their pantry (My Kitchen).

**Nothing is ever executed by a voice command.** `POST /ai/voice` returns a *proposed
action*: the exact request the app would make. The app makes that request only after the
person taps Confirm.

## The flow

```
app records ≤ 30 s ──▶ POST /media/sign-upload { purpose: "voice_audio" }
                  ──▶ upload straight to Cloudinary (private, authenticated)
                  ──▶ POST /ai/voice { context, audioUrl, publicId, durationSeconds, languageHint }
server            ──▶ downloads the clip through a signed 10-minute link
                  ──▶ Gemini: transcribe + read the intent in ONE call (voice_intent prompt)
                  ──▶ names resolved against your menu / orders (fuzzy, English + Urdu)
                  ◀── { transcript, intent, slots, proposedAction, candidates?, needsConfirmation: true }
app               ──▶ shows "Accept FC-7KQ2PX (2 Chicken Karahi), 20 minutes?" → Confirm
                  ──▶ calls proposedAction.method + path + body itself
```

Files never pass through the API (repository rule), so the spec's "multipart or URL" is
**URL only**: the app uploads with a signed upload, as for every other file. A typed
command (`text` instead of `audioUrl`) goes through the same reading, with no audio.

## Request

`POST /api/v1/ai/voice` — signed-in partner (food, approved) or customer (verified email).
20 per minute per address.

| Field | | |
|---|---|---|
| `context` | required | The screen: `board`, `today`, `stock`, `purchase`, `menu_search` (vendor); `food_search`, `pantry` (customer). |
| `audioUrl` | or `text` | A `voice_audio` upload of yours (m4a, mp4, aac, webm, ogg, mp3, wav; ≤ 1 MB). Anyone else's URL is `400 VALIDATION_FAILED`. |
| `publicId` | optional | From the upload response; checked against the URL. |
| `durationSeconds` | with audio | As the app measured it. Over 30 s → `400 VOICE_TOO_LONG` (also when the file is over 1 MB). |
| `text` | or `audioUrl` | A typed command, 1–300 characters. |
| `languageHint` | optional | `ur`, `en` or `auto` (default). |

## Response

```json
{
  "success": true,
  "data": {
    "voiceLogId": "…",
    "transcript": "order accept karo, bees minute",
    "language": "ur",
    "intent": "accept",
    "slots": { "etaMinutes": 20 },
    "confidence": 0.92,
    "source": "ai",
    "proposedAction": {
      "method": "POST",
      "path": "/food/vendor/orders/2b6c…/accept",
      "body": { "etaMinutes": 20 },
      "summary": "Accept FC-7KQ2PX (2 Chicken Karahi), 20 minutes"
    },
    "needsConfirmation": true
  }
}
```

- `proposedAction: null` with a `note` when the reading is clear but there is nothing to do
  ("No new orders to accept.") or more than one thing fits. Then `candidates` lists the
  choices (`[{ id, label, score? }]`) for the app to show as buttons.
- `source`: `ai` (the model read it) or `rules` (the deterministic parser read the transcript —
  when the model's answer was invalid twice, timed out, or AI is switched off for typed text).
- Paths are relative to `/api/v1`.

### Errors

| Status | Code | When | The app |
|---|---|---|---|
| 422 | `VOICE_UNCLEAR` | Not a command for this screen, or confidence < 0.5. `details: { hint, transcript }` | Shows the hint ("Try: 'order accept karo, bees minute'"). |
| 400 | `VOICE_TOO_LONG` | Over 30 s or 1 MB. | Asks for a shorter command. |
| 429 | `AI_QUOTA_REACHED` | The month's smart actions or voice minutes are used. `details: { key, limit, resetsOn, manual }` | Says when it resets; shows the buttons. |
| 503 | `AI_UNAVAILABLE` | AI switched off (`AI_ENABLED=false` or the feature not in `AI_FEATURES`), or the model failed on a recording. `details: { reason, manual }` | Shows `manual`: use the buttons, or type. |
| 403 | `FORBIDDEN` / `BUSINESS_NOT_APPROVED` / `WRONG_SERVICE` / `EMAIL_NOT_VERIFIED` | A vendor screen from a customer, a customer screen from a vendor, an unapproved business. | |
| 404 | `NOT_FOUND` | A context with no handler yet. | |

## Intents per screen

| Screen | Intent | Slots | Proposed request |
|---|---|---|---|
| `board` | `accept` | `orderCode?`, `etaMinutes?` | `POST /food/vendor/orders/:id/accept { etaMinutes? }` (5–180) |
| | `reject` | `orderCode?`, `reason?` | `POST /food/vendor/orders/:id/reject { reason }` |
| | `mark_ready` | `orderCode?` | `POST …/:id/ready` (an accepted order: `…/:id/preparing` first) |
| | `mark_unavailable` | `dish` | `PATCH /food/vendor/availability { items: [{ itemId, isAvailable: false }] }` |
| | `busy` | `minutes` (default 15) | `POST /food/vendor/busy { extraMinutes }` (5–60) |
| `today` | `set_portions` | `dish`, `count` | `PATCH /food/vendor/today { items: [{ itemId, portions }] }` |
| | `cooking_today` | `on`, `dish?` | with a dish: `PATCH /food/vendor/today { items: [{ itemId, cooking }] }`; without: `POST /food/vendor/pause` / `resume` |
| `menu_search` | `search` | `query` | `GET /food/vendor/menu/items/:id` |
| `food_search` | `search` | `query` | `GET /food/search?q=…` (the app adds `lat`, `lng`) |
| `stock` | `count` | `lines[{ name, qty, unit }]` | `POST /food/vendor/kitchen/stock/count` (every name known) |
| | `log_waste` | one line, `reason` | `POST /food/vendor/kitchen/waste` |
| `purchase` (and `stock`) | `add_purchase` | `lines[{ name, qty, unit, totalPrice }]` | `POST /food/vendor/kitchen/purchases` (`source: voice`) once every line is known and priced; else a `draft` with each line's status (`ok`, `UNIT_MISMATCH`, `UNKNOWN_INGREDIENT` + `suggestedName`) |
| `pantry` | `add_pantry` | `lines[{ name, qty, unit, expiresInDays }]` | `POST /my-kitchen/pantry/batch { items: [{ name (canonical), qty, unit, expiresOn }] }` |

Which order? A spoken code (or the last 3+ characters of it) picks it; otherwise the only
order in a fitting state (`placed` for accept/reject, `preparing` for ready); otherwise
`candidates`.

Which dish? Trigram similarity against the menu's English names and `menu_items.name_ur`
(vendors can now save an Urdu-script name). A clear winner (≥ 0.6, and 0.08 ahead of the next)
is used; else `candidates`.

## Numbers, units and names

`src/modules/ai/voice/lexicon.ts` (the rule parser's, and spelled out in the prompt):

- Roman Urdu, Urdu script and English number words: ek/ایک/one … bees/بیس/twenty … nabbe.
- Hundreds and thousands: "baara sau" = 1200, "ek hazaar do sau" = 1200.
- Fractions: adha/آدھا = ½, dedh/ڈیڑھ = 1½, dhai/ڈھائی = 2½. Modifiers: sawa = +¼,
  sarhe = +½, paune = −¼ ("paune char" = 3¾).
- "do" after a verb ("kar do", "de do", "bana do") is "do it", not 2.
- Units: kilo/کلو → kg, gram → g, litre/لیٹر → l, ml, darjan/درجن → dozen,
  adad/dana → piece, packet, tray.
- Ingredient names (P1, P2): your ingredients first, then `ingredient_aliases`. 440 seeded
  aliases map to 100 canonical ingredients ("tamatar", "ٹماٹر" → tomato; "murghi",
  "مرغی", "چکن" → chicken), and staff can add more.

## Accuracy

`npm run voice:eval` measures the set in `voice-eval/manifest.json`: 60 phrases (Urdu
script, Roman Urdu, English) across every screen.

- **40 tuning phrases**: the rule parser was written against them, so its score there is
  optimistic.
- **20 held-out phrases**: written before the parser was scored on them and never tuned on.

Three readers are measured:

- **Rules**: the deterministic parser, on written phrases.
- **Model, text**: the current `voice_intent` prompt, on written phrases.
- **Model, audio**: the same prompt on spoken clips. The model transcribes and reads in one
  call. Clips are synthesised with Gemini TTS (varied voices) into `voice-eval/clips/`;
  **real recordings** dropped in `voice-eval/recordings/<id>.<ext>` replace them. Both
  folders are git-ignored.

"Intent + slots" counts a phrase right only when the intent and every expected slot are right:
numbers exactly, names at similarity ≥ 0.6, purchase/pantry lines in order.

<!-- voice-eval:start -->
Measured 2026-10-21: model gemini-3.5-flash, voice_intent@3; 0 of 60 phrases read as text, 22 as audio (22 clips synthesised with gemini-3.8-flash-tts, gemini-3.8-flash-lite-tts, 0 real recordings).
1 model calls returned no answer (timeout or HTTP error) and are not counted; the next run retries them.

| Phrases | Rules, tuning (40) | Rules, held-out (20) | Model, text | Model, audio |
|---|---|---|---|---|
| Intent — Urdu script | 100% (7/7) | 100% (4/4) | — | 100% (3/3) |
| Intent — Roman Urdu | 100% (19/19) | 90% (9/10) | — | 100% (8/8) |
| Intent — English | 100% (14/14) | 100% (6/6) | — | 100% (11/11) |
| Intent — All | 100% (40/40) | 95% (19/20) | — | 100% (22/22) |
| Intent + slots — Urdu script | 100% (7/7) | 100% (4/4) | — | 100% (3/3) |
| Intent + slots — Roman Urdu | 100% (19/19) | 90% (9/10) | — | 100% (8/8) |
| Intent + slots — English | 100% (14/14) | 100% (6/6) | — | 100% (11/11) |
| Intent + slots — All | 100% (40/40) | 95% (19/20) | — | 100% (22/22) |
<!-- voice-eval:end -->

### Runs so far

The block above is rewritten by each `npm run voice:eval` (current model and prompt version).
Every run so far:

| Date | Reader | Model | Prompt | Measured | Intent | Intent + slots |
|---|---|---|---|---|---|---|
| 2026-10-19 | rules | — | — | 40 tuning + 20 held-out (written) | 100% / 95% | 100% / 95% |
| 2026-10-19 | model, text | gemini-2.5-flash | voice_intent@1 | 21 | 100% (21/21) | 62% (13/21) |
| 2026-10-19 | model, text | gemini-3.8-flash | voice_intent@2 | 16 (+1 HTTP 503) | 100% (16/16) | 100% (16/16) |
| 2026-10-19 | model, audio | gemini-3.8-flash | voice_intent@2 | 0 — all 20 calls timed out at 30 s | — | — |
| 2026-10-19 | model, audio | gemini-3.5-flash | voice_intent@2 | 17 clips (9 English, 8 Urdu) (+2 no answer) | 100% (17/17) | 71% (12/17) |
| 2026-10-20 | model, audio | gemini-3.5-flash | voice_intent@3 | 21 clips (11 English, 2 Urdu script, 8 Roman Urdu) (+1 HTTP 503) | 100% (21/21) | 100% (21/21) |
| 2026-10-21 | model, audio | gemini-3.5-flash | voice_intent@3 | 1 clip (Urdu script) (+1 HTTP 503), then the daily limit | 100% (1/1) | 100% (1/1) |

What changed between versions:

- **@1 → @2.** A schema per screen with slot descriptions, worked examples, and only the
  intent's own slots. Model readings are completed by the rule parser. Slots went from
  62% to 100% on text.
- **@2 → @3.** The transcript is always required. Every @2 audio miss had left out the
  transcript together with the portion count or a line's price, so the rules had nothing to
  complete from.

**@3 on audio: 21 of 21 with every slot right** (it was 12 of 17 on @2). The transcript is now
always there for the rules to complete from. The model has not read written commands under @3
yet.

**Coverage.** The spec asks for 20 Urdu and 20 English clips. 21 have been read under @3 (and
17 under @2), because this key's free tier allows about 20 requests per model per day. 60 synthesised clips
are ready in `voice-eval/clips/`. `npm run voice:eval -- --only audio` resumes where it
stopped; run it once a day until all are measured, or with a paid key in one go. Real kitchen
recordings in `voice-eval/recordings/` replace the synthesised clips.

**Why AI_MODEL is gemini-3.5-flash.** On written commands 3.8-flash was the most accurate.
On audio, though, all 20 of its calls timed out while 3.5-flash answered in about 3 s, so
voice uses 3.5-flash.

Synthesised speech is cleaner than a real kitchen, with no fryer, no traffic and no
half-finished sentences. Treat the audio column as an upper bound until real recordings
are added.

## Fallbacks — AI never blocks the kitchen

| Situation | What happens |
|---|---|
| Typed command, model invalid twice / timed out / AI off | The rule parser reads it (`source: "rules"`). |
| Recording, model fails | `503 AI_UNAVAILABLE` with `manual`. A recording can't be read without the model. |
| `STT_PROVIDER=google` | Google Speech-to-Text (ur-PK, en-PK alternative) transcribes; then the text path above (model, else rules). Off by default; needs `GOOGLE_CLOUD_API_KEY` and a billing account, so it isn't provisioned. |
| Quota used | `429 AI_QUOTA_REACHED` with `resetsOn`. A cached answer (same typed text, 24 h) is free. |

## Retention and privacy

- Recordings are private (`authenticated`) Cloudinary assets in the uploader's own folder.
  The hourly `ai-retention` job deletes the audio after **24 h** (`voice_logs.audio_deleted_at`).
- `voice_logs` keeps the transcript and the reading for quality review for **30 days**, then
  deletes the row.
- Transcripts are never logged (Pino) and never sent anywhere but the model.
- Usage rows (`ai_usage`) hold counts and timings only — no audio, no text.

## Allowances

| Who | Smart actions / month | Voice minutes / month |
|---|---|---|
| Vendor (`community` plan) | 300 | 120 |
| Customer | 60 | — (counted as actions) |

These are calendar months in Pakistan time; they reset on the 1st. Staff can override a vendor
through `PATCH /admin/food/vendors/:id/plan { overrides: { limits: { ai_actions_month, voice_minutes_month } } }`.
A recording costs one action and its seconds (rounded up). `GET /ai/usage` shows the
caller's count; vendors also see it in `GET /food/vendor/plan` (`limits` / `usage`).

## The announcement

`GET /ai/announce?orderId=…&lang=ur|roman|en` (vendor; another vendor's order is 404)
returns a template-built announcement, with no model involved:

> نیا آرڈر، ڈیلیوری۔ آرڈر 7 K Q 2 P X۔ ۲ چکن کڑاہی۔ کل ۳,۲۰۰ روپے، کیش آن ڈیلیوری۔

The app speaks `text` with the device voice. `ttsUrl` is an audio `data:` URL only when
`TTS_PROVIDER=google` (off by default, for devices without an Urdu voice).

## Adding a screen

A module registers a handler in `onModuleInit`:

```ts
this.voiceContexts.register({
  context: 'pantry',
  hint: 'Try: “do kilo aloo”',
  authorize: async (user) => ({ actor, scope, vocabulary }), // throws 403 for the wrong user
  resolve: async (intent, scope, transcript) => ({ proposedAction, candidates?, draft?, note? }),
});
```

Then add its intents to `VOICE_INTENTS` (`voice.types.ts`), the prompt if it is new, rules in
`rule-parser.ts`, and phrases to the manifest.
