# MetroMatrix API — Chunk 5 contract (Food Court Kitchen Intelligence)

This file is the contract the Kitchen Intelligence app chunk is built from. It ships in three
milestones; this edition covers **5A, vendor operations** (stock, recipes, purchases,
costing, price watch, waste, forecast and prep, smart ETA, outage pause, Bachat Box,
packing proof, voice and the AI layer). 5B (growth) and 5C (AI assistants, nutrition,
My Kitchen) extend it.

Everything here is enforced by the e2e suite:

- `test/kitchen-*.e2e-spec.ts` and `test/ai-voice.e2e-spec.ts`;
- the release gate `test/qa-matrix-kitchen.e2e-spec.ts` (one test per QA row).

Voice is in `docs/VOICE.md`; the AI layer (prompts, schemas, quotas, fallbacks, cost) is in
`docs/AI.md`. The conventions of `docs/API_AUTH.md` and `docs/API_FOOD.md` all apply. Runnable
flows: `npm run postman:kitchen` (needs `seed:food` and `seed:kitchen`).

**Base URL:** `https://<host>/api/v1`.

| Who | Prefix | Account |
|---|---|---|
| Vendor | `/food/vendor/kitchen`, plus `/food/vendor/pause` | `@FoodVendor()`: partner, food business approved |
| Rider | `/food/rider/orders/:id/packing-proof` | role `rider` |
| Customer | `/food/surplus` (nearby boxes: signed out works) | customer, verified email |
| Voice | `/ai/voice`, `/ai/announce`, `/ai/usage` | partner or customer, by screen |
| Staff | `/admin/kitchen` | `admin` / `super_admin`, every write audited |

**Rules this chunk adds.**

- **Stock never blocks an order.** Accepting always works; stock may go negative, and the
  vendor gets "log your purchase".
- **AI is a suggestion until a person confirms.** Voice, receipt scan and the packing check
  return drafts; nothing is saved or executed by the AI endpoints.
- **Every AI feature has a manual path.** When AI is off, over quota, slow (> 12 s) or
  invalid, the endpoint gives the deterministic result or `503 AI_UNAVAILABLE` with
  `details.manual`. Ordering never depends on it.
- **Zero commission, vendors paid directly.** A Bachat Box is paid at pickup or by transfer to
  the vendor's own account.
- **Isolation.** Another vendor's ingredient, recipe, purchase, waste entry, forecast, box,
  reservation or order is **`404`**. A store or doctor partner gets `403 WRONG_SERVICE`.

---

## 1. Units and money

- Ingredients are counted in a **base unit**: `g`, `ml` or `piece`. Quantities everywhere
  are sent as `{ qty, unit }` and converted by `kitchen/stock/units.ts`:
  - `kg`↔`g`, `l`↔`ml`, `dozen`↔`piece`;
  - spoken spellings (`kilo`, `کلو`, `darjan`);
  - the ingredient's own units (`customUnits: [{ name: "tray", factor: 30 }]`).

  A unit of the wrong kind is `400 UNIT_MISMATCH` with `details.allowed`.
- Responses carry base numbers and a friendly `…Display: { qty, unit }` (5000 g →
  `{ qty: 5, unit: "kg" }`).
- **Costs** are rupees per base unit (`numeric(12,4)`), e.g. `avgCost: 0.2333`. They are
  shown per buying unit as `avgPrice: { price: 233, per: "kg" }`. Money totals are whole
  rupees.
- **Weighted average cost.** On every purchase:
  `avg = (held × avg + qty × unitCost) / (held + qty)`, where `held` is what is on hand (a
  shortfall counts as 0). Using stock doesn't change it.

## 2. Ingredients and stock

| Route | |
|---|---|
| `GET /food/vendor/kitchen/setup` | `{ ingredients, items, itemsWithRecipe, itemsWithoutRecipe: [{ id, name }] }`. A dish without a card isn't stock-tracked. |
| `GET/POST /ingredients`, `GET/PATCH/DELETE /ingredients/:id` | See the body below. `?q&category&active=true\|false\|all`. A duplicate name (case-insensitive) is `409 CONFLICT`. `baseUnit` is locked once stock moved or a recipe uses it. DELETE is a delete when nothing refers to it, else `{ deactivated: true }`. |
| `GET /stock?filter=all\|expiring\|below_par\|negative&q&category` | Ingredient rows plus `summary: { ingredients, value, expiringIn3Days, belowPar, negative }`. Negative first, then expiring. |
| `POST /stock/count` | `{ lines: [{ ingredientId, qty, unit }], note? }` sets on-hand to what was counted (`count_adjust` movements) → `{ countId, adjusted: [{ before, counted, delta }] }`. |
| `GET /stock/:ingredientId/movements` | The ledger, newest first: `{ delta, reason (purchase\|order\|order_cancel\|waste\|count_adjust\|manual), refType, refId, orderCode?, balanceAfter, unitCost, value, batchId, note, at }`. |
| `GET /stock/:ingredientId/batches` | Batches on the shelf, oldest first — what FIFO uses next. |

The ingredient body is:

```
{ name, nameUr?, category, baseUnit, customUnits?, parLevel?: { qty, unit },
  openingStock?: { qty, unit, totalCost?, expiresOn? } }
```

`category` is one of `meat`, `vegetable`, `dairy`, `spice`, `grain`, `oil`, `bakery`,
`beverage`, `packaging` or `other`.

An ingredient row is:

```json
{ "id": "…", "name": "Eggs", "nameUr": "انڈے", "category": "dairy", "baseUnit": "piece",
  "customUnits": [{ "name": "tray", "factor": 30 }], "units": ["piece", "dozen", "tray"],
  "onHand": 90, "onHandDisplay": { "qty": 90, "unit": "piece" }, "parLevel": 60, "belowPar": false,
  "negative": false, "avgCost": 30, "avgPrice": { "price": 30, "per": "piece" }, "lastCost": 30,
  "value": 2700, "expiringSoon": 0, "isActive": true, "usedInRecipes": 2 }
```

**How stock moves.** `KitchenStockService` is the only code that changes stock.

- It locks the ingredients in id order.
- **Stock in** settles any shortfall first; the rest becomes a batch.
- **Stock out** uses the oldest batches first; what no batch covers is a shortfall at the
  average cost.
- Every change is one movement per batch, with the balance after it.

## 3. Recipe cards and automatic sold-out

| Route | |
|---|---|
| `GET /items/:itemId/recipe[?variantId]` | The card, or `null`. |
| `PUT /items/:itemId/recipe[?variantId]` | Replaces the card; see the body below. Another kitchen's dish, size, ingredient or option is `404`. |
| `DELETE /items/:itemId/recipe[?variantId]` | |
| `GET /items/:itemId/servings` | `{ hasRecipe, servings, cards: [{ cardId, variantId, servings, limitedBy: { ingredientId, name } }] }` |

The PUT body:

```
{ yieldServings? (1–500), notes?,
  lines: [{ ingredientId, qty, unit, optionId?, isPackaging? }] }
```

- `optionId`: the line is used only when that add-on is chosen. The option must be in a
  group linked to the dish.
- `isPackaging`: costed and deducted, but never what makes a dish sold out.

A size without its own card uses the dish's. The card view adds `costPerServing` (base
lines at today's average cost), `servings` and `limitedBy`.

- **Deduction on accept**, not on placing. The recipe × quantity is taken out, FIFO. Add-on
  lines count only when the option was chosen. Items without a card are skipped. This happens
  once per order (`food_orders.stock_deducted_at`).
- **Restore on cancel** after accept puts the stock back into the same batches, once
  (`stock_restored_at`).
- **Servings** = min over the card's base lines (packaging and add-ons excluded) of
  ⌊on hand ÷ per-serving quantity⌋. A dish is sold out by stock when every card makes < 1:
  - `branch_item_overrides.auto_reason = 'stock'`;
  - the vendor is told (`kitchen.sold_out_stock`).

  When a purchase or count brings it back to ≥ 1, it is available again
  (`kitchen.back_in_stock`). **A vendor's own sold-out (or "off until") is never undone.**
  Any manual change clears `auto_reason`.

## 4. Suppliers, purchases and receipt scan

| Route | |
|---|---|
| `GET/POST /suppliers`, `PATCH/DELETE /suppliers/:id` | `{ name, phone?, notes? }`; the list adds `lastPurchaseAt`, `spent30d`. |
| `GET /purchases?supplierId&ingredientId&from&to` | Paged; `{ purchasedAt, total, source, supplier, lines, hasReceipt }`. |
| `POST /purchases` | See the body below. Each line is a batch, a `purchase` movement and the new average cost. |
| `GET /purchases/:id` | With lines (`unitCost`, `remaining` of its batch) and `receiptDownload` (a signed 10-minute link). |
| `PATCH /purchases/:id` | Supplier, date or note only. |
| `DELETE /purchases/:id` | Only while none of it has been used (`409 CONFLICT` otherwise — log a count instead). The rest is re-valued at the batches left. |
| `POST /purchases/scan` | `{ imageUrl, publicId? }` — a `receipt` upload (private). 10/min. |

The `POST /purchases` body:

```
{ supplierId?, purchasedAt?, receiptUrl?, receiptPublicId?,
  source?: manual|voice|receipt_scan, note?,
  lines: [{ ingredientId, qty, unit, totalPrice, expiresOn? }] }
```

**Receipt scan** sends the bill photo to `receipt_scan@1` and returns a draft. **Nothing is
saved.**

```json
{ "supplier": { "id": "…", "name": "Ashraf Sabzi Mandi" }, "supplierName": "Ashraf Sabzi", "date": "2026-10-18",
  "total": 1950, "linesTotal": 1950, "totalMismatch": false, "confidence": 0.9,
  "lines": [
    { "spoken": "tamatar", "status": "ok", "ingredientId": "…", "name": "Tomato", "qty": 5, "unit": "kg", "qtyBase": 5000, "totalPrice": 1200 },
    { "spoken": "bhindi", "status": "UNKNOWN_INGREDIENT", "suggestedName": "okra", "candidates": [] }
  ],
  "proposedAction": null, "draft": { "receiptUrl": "…", "source": "receipt_scan", "lines": [ … ] }, "needsConfirmation": true }
```

- `proposedAction` is the exact `POST /purchases` to make once every line is known and priced.
- An unknown name is offered for creation under `suggestedName`, the alias table's name for
  it.
- AI off or failed → `503 AI_UNAVAILABLE` ("Type the bill's lines into a new purchase.").
- Over quota → `429 AI_QUOTA_REACHED`.

## 5. Costing, price watch and settings

| Route | |
|---|---|
| `GET /settings`, `PATCH /settings` | `{ targetFoodCostPct (5–95, default 35), requirePackingPhoto }` |
| `GET /costing` | `{ targetFoodCostPct, items: [CostRow], summary: { dishes, withRecipe, aboveTarget, avgFoodCostPct } }` |
| `GET /price-watch` | `{ city, items: [WatchRow], suggestions: [{ ingredientId, name, reference }] }` |
| `GET /price-watch/reference-items?q` | The PBS SPI items, for mapping. |
| `PATCH /ingredients/:id/reference` | `{ referenceItemId \| null }` (same base unit, else `UNIT_MISMATCH`). |

`CostRow` is one per dish and size:

```json
{ "itemId": "…", "name": "Mutton Karahi", "variantId": "…", "variantName": "Half", "price": 800, "hasRecipe": true,
  "cost": 200, "foodCostPct": 25, "margin": 600, "uncosted": [], "lastWeekPct": 24.1, "trend": 0.9, "aboveTarget": false }
```

- `cost` is the cost per serving: card lines ÷ yield × average cost, packaging included,
  add-ons not.
- `trend` is food cost % points against last week's snapshot (`item_cost_snapshots`, taken
  weekly and on the first look of the week).
- When a purchase pushes a dish over the target, the vendor gets `kitchen.food_cost_high`.

`WatchRow` compares the vendor's **last** price with the **Pakistan Bureau of Statistics
weekly SPI** price in the branch's city, per the SPI unit:

```json
{ "ingredientId": "…", "name": "Tomato", "reference": { "id": "…", "name": "Tomatoes", "unit": "kg" }, "city": "Lahore",
  "weekEnding": "2026-10-15", "referencePrice": 180, "yourPrice": 240, "pctAbove": 33.3, "weekChangePct": 20,
  "aboveReference": true, "referenceRising": true }
```

- `aboveReference` when more than 15% over.
- `referenceRising` when the city price rose more than 10% in a week.
- Suggestions map unmapped ingredients through the alias table ("Tomato" → tomato →
  "Tomatoes").

## 6. Waste

| Route | |
|---|---|
| `POST /waste` | `{ ingredientId \| menuItemId, qty, unit, reason, note? }` |
| `GET /waste?reason&from&to` | Paged. |
| `GET /waste/summary?range=7d\|30d\|90d` | `{ range, from, to, totalCost, entries, previousCost, changePct, byReason, top, daily }` |

- `reason` is one of `expired`, `spoiled`, `overcooked`, `returned`, `leftover` or `other`.
- An ingredient is taken out of stock (FIFO).
- A dish is entered in `serving`s, and its recipe is taken out. A dish has no other unit:
  anything else is `UNIT_MISMATCH`.
- `cost` is what the stock was worth at the batches' cost. A dish without a card has
  `cost: null`.

## 7. Insight cards

`GET /insights/cards` returns a prioritised list (priority 5 = act today), most urgent first:

```json
{ "kind": "food_cost_high", "priority": 3, "title": "Mutton Karahi costs 60% of its price",
  "body": "Your target is 35%. Ingredients are Rs 600 for a Rs 1000 plate — review the price or the recipe.",
  "action": { "label": "Open costing", "screen": "kitchen.costing", "params": { "itemId": "…" } }, "data": { … } }
```

The kinds today are:

- `expiring_stock` — 3 days or less, or past its date;
- `food_cost_high` — above the target;
- `food_cost_rising` — more than 5 points this week;
- `price_above_reference`;
- `reference_rising`;
- `sold_out_by_stock`;
- `negative_stock`;
- `waste_spike` — at least 1.5× the usual week and at least Rs 500;
- `forecast_gap` — tomorrow needs more than the shelf has;
- `surplus_suggestion` — the last two hours before closing, with portions left.

The app opens `action.screen` with `action.params`.

## 8. Forecast, prep sheet, shopping list, portions

| Route | |
|---|---|
| `GET /forecast?from&days (≤ 14)` | `{ from, to, learning, items: [{ id, itemId, name, date, expected, low, high, method, label, adjusted, basis }], accuracy: { recent: [{ date, mape, items }], mape14d } }` |
| `PATCH /forecast/:id` | `{ adjusted: int \| null }` — your own number for that dish and day; the nightly rewrite keeps it. |
| `GET /prep-sheet?date` (default tomorrow) | `{ date, dishes: [{ itemId, name, planned, forecast, adjusted, extra, hasRecipe }], ingredients: [{ category, lines: [{ need, inStock, short, …Display }] }], dishesWithoutRecipe }` |
| `GET /shopping-list?date` | `{ date, bufferPct: 10, lines: [{ need, inStock, parLevel, toBuy, toBuyDisplay, reason: plan\|par_level }], text, whatsappUrl }` |
| `GET /portions/suggestions?date` | Home kitchens. See below. |
| `POST /portions/apply-suggestion` | `{ date }`, today or tomorrow. Today resets what's left; tomorrow sets the daily limit the nightly reset uses. |
| `GET /eta-accuracy` | `{ orders, onTime, onTimePct, avgLateMinutes, configuredPrepMinutes, learned: [{ hour, size, p50, p75, samples, inUse }] }` |

A portion suggestion is `{ suggested, fromForecast, fromStock, cappedByStock, current }`.

**The forecast** (`kitchen/forecast/forecast.ts`, unit-tested against hand calculations)
runs nightly at 02:30 PKT for the next 7 days.

- **Under 14 days of history** → `method: "learning"`. Expected = the last 7 days' daily
  average, the band is ½× to 1.6×, and `label` is "Learning your patterns".
- **Otherwise** a weighted average of the last 6 same weekdays (weights 0.3, 0.25, 0.15,
  0.12, 0.1, 0.08, newest first). With fewer than 6 it is `weekday_avg`, renormalised.
- The result is multiplied by:
  - the **trend**: the last 14 days ÷ the 14 before, clamped 0.8–1.2;
  - the **event factor** (Ramadan, Eid, public holidays from `calendar_events`): the dish's
    own ratio on its last such event, else a default (Eid 0.7, holiday 1.15).
- `low`/`high` = expected ∓ 1.28 × the weighted spread (about an 80% band).
- Accuracy is MAPE: |actual − expected| ÷ max(actual, 1), averaged over dishes with a
  forecast or a sale. It is scored the next night.

**Planned portions** are, per dish: `adjusted`, else the forecast rounded, **plus certain
demand** (tiffin and catering in 5B). The prep sheet multiplies them by the cards' base lines
(packaging included, add-ons not). The shopping list buys:

```
toBuy = max(need × 1.1 − stock, need + par − stock, 0)
```

## 9. Smart ETA and outage pause

**Smart ETA.** Nightly, each kitchen's real prep times (accepted → ready, last 30 days) are
summarised per local hour and order size (`1-2`, `3-5`, `6+` items), as p50 and p75
(`prep_time_stats`).

- Quotes use **p75** for the current hour and size once that bucket has ≥ 20 samples,
  otherwise the vendor's `prepMinutes`.
- Quotes carry `prepMinutes` and `prepSource: learned | configured`.
- Discovery, the cart preview and checkout all quote this way, and accept defaults to the
  quoted ETA.

**Outage quick-pause.** `POST /food/vendor/pause` takes
`{ reason?: gas|electricity|weather|staff|stock|other, minutes?: 5–720, message? }`.

- With `minutes`, it resumes by itself (the minute job).
- Customers see "Temporarily paused · back around 4:30 PM", or your message. **They never see
  the reason.**
- The vendor profile shows `pauseReason` and `autoResumeAt`. `POST /resume` clears all of it.

## 10. Bachat Box (surplus) and donations

**Vendor** routes:

| Route | |
|---|---|
| `GET /surplus-boxes?status` | Each box has `reserved` and `collected`. |
| `GET /surplus-boxes/suggestion` | In the last two hours before closing: a draft from today's planned portions not yet sold (half the menu value). |
| `POST /surplus-boxes` | `{ title, description?, contentsHint?, originalValue, price ≤ originalValue, quantity 1–200, pickupFrom, pickupTo, tags? }` — the window is **today** and ends in the future. |
| `PATCH /surplus-boxes/:id` | The price is fixed once someone has reserved; the quantity can't drop below what's reserved. |
| `POST /surplus-boxes/:id/cancel` | Reservations are cancelled and the customers told. |
| `GET /surplus-reservations?boxId&status` | |
| `POST /surplus-reservations/:id/collected` | `{ code? }` — checked when given. |
| `POST /surplus-reservations/:id/no-show` | After the window closes (`409` before). |
| `GET/POST /donations` | `{ organisation, meals, notes?, photoUrl? (kitchen_story upload) }` → `{ mealsRescued, donatedMeals, boxesCollected, items }` |

**Customer** routes (`/food/surplus`):

| Route | |
|---|---|
| `GET /food/surplus?lat&lng&radiusKm (default 8)` | Live boxes from open kitchens, nearest first, with `pickupLabel` and `discountPct`. Public. |
| `POST /food/surplus/:boxId/reserve` | `{ quantity 1–10, paymentMethod?: pay_at_pickup\|transfer }` + **`Idempotency-Key`** → `{ code: "BB-7KQ2PX", total, payTo (transfer: the vendor's accounts), … }` |
| `GET /food/surplus/reservations` | Mine. |
| `POST /food/surplus/reservations/:id/cancel` | Before the window closes. The box goes back on the shelf. |

**Rules.**

- One conditional `UPDATE … WHERE remaining >= qty` decides who gets the last box. The other
  customer gets `409 SURPLUS_SOLD_OUT`.
- After the window: `409 SURPLUS_WINDOW_CLOSED`. Unsold boxes expire (5-minute job).
- **Three no-shows** block the customer from reserving for **14 days** (`403 SURPLUS_BLOCKED`,
  `details.until`), and they are told. The count then starts again.
- **Meals rescued** = collected boxes + donated meals.

## 11. Packing proof

- `POST /food/vendor/kitchen/orders/:id/packing-proof` (vendor) or
  `POST /food/rider/orders/:id/packing-proof` (the assigned rider) takes `{ photoUrl, publicId? }`
  (a `packing_proof` upload). The order must be accepted, preparing or ready. The response is
  `{ orderId, photoUrl, takenBy, aiCheck }`.
- With `requirePackingPhoto` on, `on_the_way` (rider pickup or hand-over to your own rider) and
  `picked_up` without a photo are **`409 PACKING_PHOTO_REQUIRED`**.
- `aiCheck` (feature `packing_check`, prompt `packing_check@1`) is advisory and never blocks:
  `{ expectedItems, detectedItems, match, missing, confidence, note, advisory: true }`. It is
  `null` when AI is off or the check failed.
- Order views (customer, vendor, rider) gain `packingPhotoUrl`.

## 12. Voice and AI (summary; see docs/VOICE.md and docs/AI.md)

- `POST /ai/voice` takes `{ context, audioUrl | text, durationSeconds?, languageHint? }`.
  The screens are:
  - `board`, `today`, `stock`, `purchase`, `menu_search` (vendor);
  - `food_search` (customer).

  It returns `{ transcript, intent, slots, proposedAction, candidates?, draft?, confidence, source, needsConfirmation: true }`.
  **Nothing is executed.**
- `GET /ai/announce?orderId&lang=ur|roman|en` (vendor) returns
  "Naya order: do Chicken Biryani, ek Raita, pickup, cash. Total 1,250 rupay. Order 7 K Q 2 P X."
  and `ttsUrl` (Google TTS, off by default).
- `GET /ai/usage` returns `{ aiActions: { used, limit }, voiceMinutes, resetsOn, enabled, voiceContexts }`.
- The allowances are monthly, in Pakistan time. Vendors get **300 smart actions and 120 voice
  minutes** (plan `community`, overridable by staff); customers get 60 actions.

## 13. Staff (`/admin/kitchen`)

| Route | |
|---|---|
| `POST /admin/kitchen/reference-prices/import` | `{ csv }` (≤ 512 KB), header `week_ending,city,item,unit,price`. See below. |
| `GET /admin/kitchen/reference-items?q` | |

**Why a CSV.** PBS publishes the weekly SPI as a **PDF** (city prices in Appendix-A); there is
no CSV or API. Staff transcribe the rows they need into this template, for example
`2026-10-15,Lahore,Tomatoes,kg,180`.

**What the import does.**

- It upserts items (by name) and prices (item, city, week).
- Units: `kg`, `g`, `250 grams`, `litre`, `ml`, `dozen`, `piece`/`each`. Anything else is
  rejected by line.
- It returns `{ items, prices, cities, weeks, rejected, errors: [{ line, error }] }`.
- It is audited as `kitchen.reference_prices.import`.

## 14. Error codes added in Chunk 5 (5A)

| Code | Status | When |
|---|---|---|
| `AI_UNAVAILABLE` | 503 | AI off (`AI_ENABLED`, `AI_FEATURES`), failed or timed out where there is no deterministic answer. `details: { reason, manual }`. |
| `AI_QUOTA_REACHED` | 429 | The month's smart actions or voice minutes are used. `details: { key, limit, resetsOn, manual? }`. |
| `VOICE_UNCLEAR` | 422 | Not a command for this screen, or confidence < 0.5. `details: { hint, transcript }`. |
| `VOICE_TOO_LONG` | 400 | Over 30 s or 1 MB. |
| `UNKNOWN_INGREDIENT` | (line status) | A spoken or scanned name the kitchen doesn't have: on the draft line, with `suggestedName`. |
| `UNIT_MISMATCH` | 400 | A unit of another kind. `details: { unit, baseUnit, allowed }`. |
| `PACKING_PHOTO_REQUIRED` | 409 | Handing over without the packing photo when the setting is on. |
| `SURPLUS_SOLD_OUT` | 409 | Someone got the last box first. |
| `SURPLUS_WINDOW_CLOSED` | 409 | The pickup window has closed (reserve or cancel). |
| `SURPLUS_BLOCKED` | 403 | Three no-shows. `details.until`. |
| `RECIPE_INCOMPLETE`, `TIFFIN_FULL`, `TIFFIN_SKIP_CUTOFF_PASSED`, `CATERING_QUOTE_EXPIRED`, `NUTRITION_UNAVAILABLE` | | Reserved for 5B and 5C. |

## 15. Notifications (`type`)

| Type | When |
|---|---|
| `kitchen.sold_out_stock` | A dish is sold out by stock. |
| `kitchen.back_in_stock` | Stock brought it back. |
| `kitchen.stock_negative` | An ingredient went below zero (once until it is back ≥ 0). |
| `kitchen.expiring` | A batch is 3 days or 1 day from its date, once each. |
| `kitchen.expired` | A batch is past its date (flagged, never written off). |
| `kitchen.food_cost_high` | A purchase pushed a dish over the target. |
| `kitchen.surplus.reserved` | A Bachat Box was reserved (to the vendor). |
| `food.surplus.cancelled` | The kitchen cancelled a box you reserved. |
| `food.surplus.blocked` | Three no-shows. |

Kitchen alerts are written to an outbox (`kitchen_alerts`) in the same transaction as the
stock change. They are sent right after it commits (`FoodNotifier.afterChange`), and by a
minute job as a safety net, so a rolled-back accept never notifies.

## 16. Scheduled jobs (advisory-locked, idempotent; `JOBS_ENABLED`)

| Job | When | What |
|---|---|---|
| `kitchen-alerts` | every minute | Send pending kitchen alerts. |
| `kitchen-surplus-expiry` | every 5 min | Unsold boxes past their window → expired. |
| `kitchen-expiry-alerts` | every 15 min | 3-day / 1-day / past-date alerts per batch, each once. |
| `kitchen-nightly` | 02:30 PKT | Per kitchen: yesterday's accuracy, the next 7 days' forecasts; weekly cost snapshots. |
| `food-nightly` (Food) | 03:30 PKT | Adds the prep-time stats for the smart ETA. |
| `food-reminders` (Food) | every minute | Adds auto-resume of timed pauses. |
| `ai-retention` | hourly | Delete voice audio after 24 h, voice logs after 30 days, expired cache. |

## 17. Decisions this contract makes (adaptations to the repo)

- **Voice audio is a URL, not multipart.** Files never pass through the API (repository
  rule), so recordings are signed `voice_audio` uploads (private). `text` is accepted too.
- **The spec's `AiQuotaGuard` is a check inside `AiService`**, so cached answers stay free and
  each call is metered once.
- **`ai_usage.at` and `stock_movements.at` are `created_at`** (the repo's BaseEntity).
- **`AI_MODEL` (default `gemini-3.5-flash`) is separate from `GEMINI_MODEL`**, so the symptom
  checker is unchanged. `gemini-3.8-flash` read text well, but every audio call to it timed
  out at 30 s in the eval, so voice can't use it (`docs/VOICE.md`).
- **Packaging lines** are deducted and costed but never make a dish sold out.
- **The smart-ETA stats** live with Food's availability code (`prep_time_stats`), because
  quotes read them. The computation is in Food's nightly job.
- **`calendar_events`** is created now (the forecast needs it); its staff CRUD comes with
  Ramadan mode (5B, P7).
- **The PBS SPI importer takes a documented CSV template** (§13).
- **Expired batches are flagged, never written off** — a person logs the waste.

## 18. Demo data (`npm run seed:kitchen`, after `seed:food`)

Three of `seed:food`'s fictional vendors get a working kitchen: Zafran Biryani Kitchen,
Qandeel Karahi House and Khala Rukhsana's Kitchen. Each has:

- 16 ingredients (Urdu names, par levels), and recipe cards for every dish;
- 60 days of collected orders, so the forecasts are `weighted` and the smart ETA has learned
  buckets;
- 8 weeks of purchases from three suppliers, with prices drifting (tomatoes up 60%);
- waste over the last month, and a stock take (tomatoes left short, for the forecast-gap
  card);
- price-watch mappings to an 8-week SPI sample for Lahore and Karachi (13 items, generated);
- forecasts and cost snapshots. Zafran also gets tonight's Bachat Box.

The data is idempotent and needs no uploads, and no model is called.
