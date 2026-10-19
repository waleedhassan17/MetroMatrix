# The AI layer — MetroMatrix Kitchen Intelligence (Chunk 5)

One small module, `src/modules/ai/`, sits under every smart feature: voice, receipt scan,
the packing check, and (5C) the menu assistant, review insights, nutrition estimates and
pantry recipes. It is built so that **AI is never needed**:

- Every feature has a manual or deterministic path.
- Every call is metered, cached where it can be, and validated before use.
- A switch turns it all off.

## 1. How a call works (`AiService.run`)

```
feature switched on? (AI_ENABLED, AI_FEATURES) ── no ─▶ { ok: false, reason: 'disabled' }
provider configured? (GEMINI_API_KEY)           ── no ─▶ 'unavailable'
cached answer? (ai_cache, 24 h, same prompt id + version + input + media hash) ─▶ use it (free)
over this month's allowance?                    ── yes ▶ 'quota' (429 AI_QUOTA_REACHED, resetsOn)
model call, 12 s budget (AI_TIMEOUT_MS)         ── slow ▶ 'timeout'
JSON → class-validator DTO + semantic checks    ── bad ─▶ one retry that shows the model its errors
                                                ── bad again ▶ 'invalid'
an ai_usage row for every outcome
```

- Callers get `AiOutcome<T>`: `{ ok: true, data, cached }` or `{ ok: false, reason }`.
- They choose their fallback. `AiService.failure(outcome, manual)` turns a failure into
  `429 AI_QUOTA_REACHED` or `503 AI_UNAVAILABLE { reason, manual }`.
- Helpers:
  - `json(call)` (the spec's `json<T>`);
  - `vision(call)` (images read server-side, private ones through a signed link — the spec's
    `vision<T>`).
- Voice is transcribed and read in one call (§5).

## 2. Provider

- `AiProvider` is abstract.
- `GeminiProvider` calls REST `generateContent` with:
  - a system instruction;
  - text and inline image/audio parts;
  - `responseMimeType: application/json` and a `responseSchema`;
  - `thinkingLevel: low` (Gemini 3+), or `thinkingBudget: 0` (2.x flash).
- **Model: `AI_MODEL`, default `gemini-3.5-flash`.** The symptom checker keeps its own
  `GEMINI_MODEL`. In the voice eval, `gemini-3.8-flash` read written commands well (16/16),
  but every audio call to it timed out at 30 s. `gemini-3.5-flash` answered audio in about 3 s.
- Tests replace the provider with `FakeAiProvider` (`test/utils/fake-ai.ts`), which scripts
  answers, timeouts and invalid JSON. **No test ever calls a real model.** Real calls happen
  only in `npm run voice:eval`.
- Speech adapters for Google Cloud Speech-to-Text (`STT_PROVIDER=google`, ur-PK with en-PK)
  and Text-to-Speech (`TTS_PROVIDER=google`, for announcements) are built but **off**. They
  need `GOOGLE_CLOUD_API_KEY` and a billing account; nothing is provisioned.

## 3. Prompts

The prompts are Markdown in `src/modules/ai/prompts/` with front matter
(`id`, `version`, `feature`, `title`). They are copied into `dist` by `nest-cli.json` assets,
and loaded once at boot: a broken file fails the boot, not a request. Every `ai_usage` row
records the prompt id and version. **Change a prompt's text → bump its version.**

| Prompt | Version | Feature | Input → output |
|---|---|---|---|
| `voice_intent` | 3 | `voice` | Audio or text + the screen's intents + vocabulary → `{ transcript, language, intent, slots, confidence }`. The schema is per screen (only that screen's intents and slots). |
| `receipt_scan` | 1 | `receipt_scan` | Bill photo + the kitchen's ingredient names → `{ supplier?, date?, lines: [{ name, qty, unit, totalPrice }], total?, confidence }` |
| `packing_check` | 1 | `packing_check` | Packed-order photo + ticket lines → `{ detectedItems, match, missing, confidence, note }` (advisory) |

Prompts for 5C — `describe`, `specials`, `combos`, `review_themes`, `nutrition_estimate` and
`pantry_recipes` — are added with their features.

## 4. Allowances (quotas)

| Who | `ai_actions_month` | `voice_minutes_month` |
|---|---|---|
| Vendor on `community` | 300 | 120 |
| Customer | 60 | — |

- The limits live in `src/modules/plans/plan-config.ts` (`CUSTOMER_AI_LIMITS` for customers).
  Staff override a vendor with
  `PATCH /admin/food/vendors/:id/plan { overrides: { limits: { ai_actions_month, voice_minutes_month } } }`.
- They are calendar months in Pakistan time and reset on the 1st (`resetsOn`).
- A call costs one action. A recording also costs its seconds, rounded up.
- Cached answers and quota refusals cost nothing.
- Usage is counted from `ai_usage` and shown in `GET /ai/usage` and `GET /food/vendor/plan`
  (`limits` / `usage`).

## 5. Fallbacks, per feature

| Feature | AI off / failed / slow | Over quota |
|---|---|---|
| Voice, typed text | The rule parser reads it (`source: "rules"`). | `429 AI_QUOTA_REACHED` |
| Voice, recording | `503 AI_UNAVAILABLE` + manual ("Use the buttons on this screen, or type the command instead of speaking.") | `429` |
| Receipt scan | `503` + "Type the bill's lines into a new purchase." | `429` |
| Packing check | The photo is saved; `aiCheck: null`. The order is never blocked. | same |
| Announcements | Template-built, never AI. | — |

**The model's reading is completed, never trusted blindly.** Slots that don't belong to the
chosen intent are dropped. When the rule parser reads the same intent from the transcript,
it fills the slots the model left empty — the count of plates, a line's price
(`voice/reading.ts`).

## 6. Data kept

| Table | What | How long |
|---|---|---|
| `ai_usage` | Who (business or user), feature, prompt id and version, tokens, latency, status (`ok`, `invalid`, `timeout`, `quota`, `error`), `cached`, audio seconds. No text, no audio. | Kept (counts for allowances and the staff dashboard) |
| `ai_cache` | Answers to identical non-personal inputs (typed voice commands) | 24 h, purged hourly |
| `voice_logs` | Transcript, reading, status — for quality review | 30 days; audio deleted after 24 h |

## 7. Switches (env; also in `.env.example`)

| Key | Default | |
|---|---|---|
| `AI_ENABLED` | `true` | `false` is the kill switch: every feature takes its manual path. |
| `AI_FEATURES` | `all` | A comma list: `voice`, `menu_assistant`, `specials`, `combos`, `photo_check`, `receipt_scan`, `packing_check`, `review_insights`, `nutrition`, `pantry_recipes`. |
| `AI_TIMEOUT_MS` | `12000` | The per-call budget, retry included. |
| `AI_MODEL` | `gemini-3.5-flash` | |
| `GEMINI_API_KEY` | — | Without it everything is manual. |
| `STT_PROVIDER` / `TTS_PROVIDER` / `GOOGLE_CLOUD_API_KEY` | `gemini` / `none` / — | |
| `GEMINI_TTS_MODEL` | `gemini-3.8-flash-tts` | Only the voice eval synthesises clips. |

## 8. Cost notes

- One voice command is one call: about 1.5k input tokens (the prompt) plus a few seconds of
  audio (≈ 50 audio tokens) and about 40 output tokens.
- A receipt is one image plus about 300 output tokens.
- At `community` limits (300 actions a vendor a month) that is a few hundred thousand tokens
  per vendor per month on a flash model.
- **The free tier is not enough for production.** In October 2026 this key had about 20
  requests per model per day. A paid key is the owner's decision (`DEPLOYMENT.md`). Until
  then, `AI_ENABLED=false` or a small `AI_FEATURES` list keeps the app fully working.
- The 24 h cache, the per-screen schema and short prompts keep calls small. Nothing is called
  in the background except what a person triggers (5C adds a nightly review-themes job,
  metered the same way).
