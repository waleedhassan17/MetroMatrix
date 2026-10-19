# MetroMatrix API — Chunk 5 contract (Food Court Kitchen Intelligence)

This file is the contract the Kitchen Intelligence app chunk is built from. It ships in three
milestones; this edition covers:

- **5A, vendor operations** (§1–18): stock, recipes, purchases, costing, price watch, waste,
  forecast and prep, smart ETA, outage pause, Bachat Box, packing proof, voice and the AI
  layer;
- **5B, growth** (§19–30): tiffin, catering, Ramadan mode, the storefront and order sources,
  kitchen story and hygiene, signature recipes, home rails and badges, the demand map and
  curve, menu engineering and experiments, rider batching.

5C (AI assistants, nutrition, My Kitchen) extends it.

Everything here is enforced by the e2e suite:

- `test/kitchen-*.e2e-spec.ts`, `test/growth-*.e2e-spec.ts` and `test/ai-voice.e2e-spec.ts`;
- the release gate `test/qa-matrix-kitchen.e2e-spec.ts` (one test per QA row).

Voice is in `docs/VOICE.md`; the AI layer (prompts, schemas, quotas, fallbacks, cost) is in
`docs/AI.md`. The conventions of `docs/API_AUTH.md` and `docs/API_FOOD.md` all apply. Runnable
flows: `npm run postman:kitchen` (needs `seed:food` and `seed:kitchen`).

**Base URL:** `https://<host>/api/v1`.

| Who | Prefix | Account |
|---|---|---|
| Vendor | `/food/vendor/kitchen`, plus `/food/vendor/pause`; 5B: `/food/vendor/{tiffin,catering,ramadan,story,storefront,demand-map,demand-curve}` | `@FoodVendor()`: partner, food business approved |
| Rider | `/food/rider/orders/:id/packing-proof` | role `rider` |
| Customer | `/food/surplus` (nearby boxes: signed out works); 5B: `/food/tiffin`, `/food/catering`, `/food/vendors/:idOrSlug/tiffin-plans` | customer, verified email |
| Public | 5B: `/public/food/store/:slug` | none |
| Voice | `/ai/voice`, `/ai/announce`, `/ai/usage` | partner or customer, by screen |
| Staff | `/admin/kitchen`; 5B: `/admin/food/{calendar-events,hygiene,signatures,demand-map}` | `admin` / `super_admin`, every write audited |

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
| `TIFFIN_FULL`, `TIFFIN_SKIP_CUTOFF_PASSED`, `CATERING_QUOTE_EXPIRED` | | 5B — see §28. |
| `RECIPE_INCOMPLETE`, `NUTRITION_UNAVAILABLE` | | Reserved for 5C. |

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
- **`calendar_events`** is created in 5A (the forecast needs it); its staff CRUD came with
  Ramadan mode (§21).
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

**Part 2 (5B)** adds:

- the calendar: Ramadan 1448 and Eid ul Fitr (expected dates; staff confirm them after the
  moon sighting) and two public holidays;
- Zafran's sehri and iftar windows (iftar on pre-order only);
- "Office lunch — weekdays" at Khala Rukhsana's, with two Karachi subscribers (one cash
  period confirmed);
- a 60-guest dawat request from Ayesha at Qandeel, quoted twice (accept v2);
- self-declared kitchen stories for Zafran and Khala Rukhsana (the staff queue verifies
  them);
- Qandeel's signature karahi;
- about 12% of Zafran's and Qandeel's history as QR and storefront orders;
- three weeks of synthetic anonymous searches around Gulberg, DHA and Johar Town (Lahore)
  and Clifton and Gulshan (Karachi), rolled into `demand_cells`;
- a running 14-day menu experiment at Zafran.

The data is idempotent and needs no uploads, and no model is called.

---

# Milestone 5B — growth

Module `src/modules/food-growth/` (tiffin, catering, ramadan, story, storefront, discovery,
demand, admin, jobs). Menu engineering and experiments live in `kitchen/engineering/`, and
rider batching in Food's `riders/`. Orders this milestone writes (tiffin, catering) go through
Food's `FoodOrderWriter` and `FoodOrderTransitionsService`, so the board, riders, realtime,
stock deduction and reviews see ordinary orders. **Zero commission still holds:** a tiffin
period, a catering advance and the balance are paid straight to the vendor.

## 19. Tiffin subscriptions

**Plan** (`/food/vendor/tiffin/plans`, `GET` list · `POST` · `GET /:id` · `PUT /:id`):

```
{ name, description?, meal: breakfast|lunch|dinner, days: [0–6] (0 = Sunday),
  period: weekly|monthly, pricePerPeriod, deliveryMode: delivery|pickup|both,
  deliveryWindowFrom: "12:30", deliveryWindowTo: "13:30", capacity (1–1000),
  skipCutoffHour? (default 20 = 8 PM the evening before),
  rotation: [{ weekday, menuItemIds: [uuid], note? }], isActive? }
```

- Every served day needs a rotation entry; a dish of another kitchen is `404`.
- The view adds `mealValue` (the period price spread over its meals), `seatsLeft`,
  `subscribers` (active + paused) and `requests`.
- `capacity` can't go below the seated subscribers (`400`).

**Subscription states:** `requested → active ⇄ paused → cancelled | ended`, or
`requested → declined`.

| Who | Route | |
|---|---|---|
| Customer | `GET /food/vendors/:idOrSlug/tiffin-plans` | Active plans with `seatsLeft` and `full`. |
| Customer | `POST /food/tiffin/subscribe` + `Idempotency-Key` | `{ planId, startsOn, paymentMethod: cash_weekly\|transfer_per_period, fulfilment: delivery\|pickup, addressId? }` → `requested`. `409 TIFFIN_FULL` when no seat is left. |
| Customer | `GET /food/tiffin/subscriptions` | An array. |
| Customer | `POST …/:id/skip` · `…/unskip` `{ date }` | Before the date's cut-off only, else `409 TIFFIN_SKIP_CUTOFF_PASSED` (`details.date`). |
| Customer | `POST …/:id/pause` `{ until }` | Every served day up to `until` whose cut-off is still open becomes a skip; days already closed are cooked as planned. |
| Customer | `POST …/:id/cancel` | |
| Customer | `POST …/:id/payment-proof` `{ proofUrl, ref? }` | A `payment_proof` upload → `proof_submitted`. |
| Vendor | `GET /food/vendor/tiffin/subscriptions?status&planId` | An array (plans and subscriptions are bounded by capacity). |
| Vendor | `POST …/:id/approve` | `requested → active` while a seat is free (else `409 TIFFIN_FULL`). |
| Vendor | `POST …/:id/decline` · `…/end` `{ reason }` · `…/pause` `{ until }` | |
| Vendor | `POST …/:id/payment/confirm` · `…/payment/reject` `{ reason }` | The period is `paid`, or back to `due`. |
| Vendor | `GET /food/vendor/tiffin/tomorrow?date` | Meals per plan, skips, what to cook, `cutoffAt`. |

**The daily orders.** Every 5 minutes a job looks at each served day whose cut-off has passed
(today and tomorrow, once the evening cut-off is past). For each subscriber not skipping, it:

1. claims the day in `tiffin_deliveries` (unique per subscription and date, so it runs once);
2. writes a scheduled `food_orders` row at the start of the delivery window, with
   `source = tiffin`, `payment_method = subscription` (already `paid` — the period covers it)
   and the rotation's dishes at the meal value;
3. accepts it as the system, so stock is deducted and it is on the board.

The delivery follows its order: `ready → prepared`, `delivered`/`picked_up → delivered`, a
cancel → `missed`. Tomorrow's meals feed the prep sheet and shopping list as certain demand
(`ForecastService.extraDemand`). The 00:10 job rolls periods over (a new period is `due`)
and resumes pauses that have ended.

## 20. Catering (dawat)

**Request states:** `requested → quoted → accepted → advance_proof → confirmed → completed`;
`declined`, `expired` and `cancelled` end it early.

| Who | Route | |
|---|---|---|
| Customer | `POST /food/catering` | `{ vendorId, eventDate, eventTime, guests, eventType: dawat\|wedding\|office\|birthday\|milad\|other, requestedItems: [{ menuItemId?, name, qty? }], budget?, fulfilment: delivery\|pickup\|on_site, addressId?, notes? }` → a `CT-XXXXXX` code. |
| Customer | `GET /food/catering` (an array) · `GET /:id` | |
| Customer | `POST /:id/accept` `{ version }` | Only the **newest** version and only before `validUntil`. An older one is `409 INVALID_TRANSITION` with `details: { version, latestVersion }`; an expired one `409 CATERING_QUOTE_EXPIRED`. With `advancePct: 0` it is `confirmed` straight away. |
| Customer | `POST /:id/advance-proof` `{ proofUrl, ref? }` | A `payment_proof` upload: `accepted → advance_proof`. |
| Customer | `POST /:id/cancel` `{ reason }` | Until confirmed. |
| Vendor | `GET /food/vendor/catering?status` · `GET /:id` | The list is an array (by event date, at most 200), each with `customer: { name, phone }`. |
| Vendor | `POST /:id/quote` | `{ lines: [{ menuItemId?, name, qty, unitPrice }], deliveryFee?, advancePct (0–100), validUntil? (3 days), notes? }` — a new version every time, editable until accepted. `total = Σ lines + deliveryFee`; `advance = round(total × advancePct / 100)`. |
| Vendor | `POST /:id/decline` `{ reason }` | |
| Vendor | `POST /:id/advance/confirm` · `/advance/reject` `{ reason }` | The advance reached your account → `confirmed`, or back to `accepted`. |

A request carries `quote` (the newest version), `versions` (newest first), `acceptedVersion`,
`advance`, `hasAdvanceProof` and, once written, `foodOrderId`.

**The event-day order.** On the event date (branch time) the 5-minute job writes the
scheduled order once, at the event time: `source = catering`, `payment_method = catering`,
`prepaid_amount` = the advance (a CHECK keeps it ≤ total), the balance paid to the vendor at
the event. Delivering it completes the request. Quote lines with a `menuItemId` feed that
date's prep sheet and shopping list. Unanswered quotes past `validUntil`, and requests whose
day passed unconfirmed, expire.

## 21. Ramadan mode and the calendar

**Staff calendar** (`/admin/food/calendar-events`, audited `calendar_event.create|update|delete`):
`GET ?kind&from&city&page` · `POST { kind: ramadan|eid|public_holiday|other, name, startsOn,
endsOn, city? }` (null = everywhere; at most 45 days; `endsOn ≥ startsOn`) · `PATCH /:id` ·
`DELETE /:id`. Every event feeds the forecast's event factor (last Ramadan's ratio when there
is history).

**Kitchen settings** — `GET/PUT /food/vendor/ramadan`:

```
{ enabled, sehriFrom?, sehriTo?, iftarFrom?, iftarTo? ("HH:mm"; both ends or neither),
  iftarPreorderOnly?, notes? }
→ { settings, events: [Ramadan for your city, now or ahead], activeToday,
    today: { event, sehri, iftar, iftarPreorderOnly } | null }
```

- **Only on dates inside a `ramadan` event** for the branch's city (or everywhere), and only
  while `enabled`, the sehri and iftar windows **replace** the weekly hours. On every other
  date — and as soon as the event is removed — the weekly hours apply. Open state, discovery,
  the cart, checkout and scheduled orders all follow it (`BranchStateService.dateOverrides`
  → `openIntervals(…, byDate)`).
- A window may cross midnight (`closes < opens`). Sehri `02:00–04:45` is the morning of that
  date.
- `iftarPreorderOnly`: an order for the iftar window must be placed **before it opens**.
  Ordering for a running iftar window (now, or scheduled into it) is
  `400 SLOT_INVALID` with `details: { iftarPreorderOnly: true, windowStart, windowEnd }`.
- The vendor page carries `ramadan` (today's block, or null); the home gets `iftarNearYou`.

## 22. Storefront and order sources

- **Public page:** `GET /public/food/store/:slug` — no sign-in, 300/min. It is the vendor page
  (info, open state, menu, story, badges, Ramadan) plus
  `storefront: { url, sources: [storefront, qr] }`. Unknown or hidden kitchens are `404`;
  paused ones still open, with their message. It is meant for the Expo web storefront at
  `STOREFRONT_BASE_URL/s/:slug`.
- **Attribution:** `POST /food/checkout` takes `source?: app|storefront|qr` (default `app`) and
  `campaign?` (`[A-Za-z0-9_.-]{1,40}`), from the link's `?src=` and `?c=`. Other sources
  (`tiffin`, `catering`, `surplus`) are set only by the system (`400` from checkout).
- **Vendor:** `GET /food/vendor/storefront?days` (7–90, default 30):

```
{ slug, url, links: { storefront, qr, campaignExample }, qr: { payload: "<url>?src=qr" },
  ordersYouBrought: { days, orders, revenue, customers, newCustomers, share (% of all orders),
                      storefront: { orders, revenue }, qr: { orders, revenue },
                      campaigns: [{ source, campaign, orders, revenue }] },
  bySource: { app|storefront|qr|tiffin|catering|surplus: { orders, revenue } } }
```

  Rejected and cancelled orders don't count. `newCustomers`: their first order with you came
  through your link or QR. The app renders the QR from `qr.payload`.

## 23. Kitchen story, hygiene badge, signature recipes

**Story** — `GET/PUT /food/vendor/story` (the whole story; omitted fields are cleared):

```
{ story? (≤ 2000), cookName?, videoUrl? (a kitchen_video upload), photos? (≤ 6 kitchen_story uploads),
  hygieneChecklist?: { gloves, hairnet, cleanWater, separateBoards, fridgeTempLog, pestControlOn } }
→ … + { hygieneStatus: null|self_declared|verified, badge, checklistComplete, declaredAt, verifiedAt }
```

- **Complete** = every box ticked and a pest-control date in the last 12 months (not in the
  future) → `self_declared`, badge `hygiene_self_declared` ("Hygiene self-declared").
- **Only staff verify**, after a visit or a video call → `verified`, badge `hygiene_verified`.
  Any later change to the checklist drops it back to `self_declared` (an incomplete one to
  null); a new story text with the same checklist keeps it.
- Staff (`/admin/food/hygiene`, audited `hygiene.verify` / `hygiene.revoke`, the vendor is
  told): `GET ?status=self_declared` (the queue, oldest first) `| verified` ·
  `POST /:brandId/verify { method: visit|video_call, note? }` (`409 INVALID_TRANSITION`
  unless self-declared) · `POST /:brandId/revoke { reason }`.

**Signature recipe** — `PUT /food/vendor/kitchen/items/:itemId/signature?variantId`
`{ isSignature, by? (default the kitchen's name), since? (default today) }`.

- It needs the dish's recipe card (`404` otherwise).
- Customers see `signature: { badge, label: "Signature recipe", by, since }` on the item sheet,
  `signatureDishes` on the vendor page and the `signature` badge on the card.
- Staff (`/admin/food/signatures`, audited `signature.remove`, the vendor is told):
  `GET ?status=claimed|removed` · `POST /:recipeCardId/remove { reason }`. A removed claim
  can be made again; it comes back to the list.

## 24. Discovery additions

- **Vendor cards** gain `badges: string[]` — `signature`, `hygiene_self_declared` |
  `hygiene_verified`, `bachat_box` (a box to collect right now).
- **Home rails**, each up to 10 cards, open first, present only when not empty:
  - `iftarNearYou` — kitchens with an iftar window today (inside a Ramadan event), best rated
    first;
  - `surplusNearYou` — a live Bachat Box, soonest pickup first; pickup-only reach counts;
  - `tiffinNearYou` — an active plan with a free seat, cheapest first.

  `homeKitchens` was already there (Chunk 4).
- **Vendor page** gains `story`, `signatureDishes` and `ramadan`; the **item sheet** gains
  `signature`.
- Sub-domains add these through `FoodDiscoveryService.badgeSources` / `railSources` /
  `vendorExtras` / `itemExtras` (lists set in `onModuleInit`).

## 25. Demand map and demand curve

**What is logged.** Every home, vendor list and search writes one `search_events` row:

- `kind`, the **geohash6 cell** (≈ 1.2 × 0.6 km), and the city of the nearest kitchen within
  30 km;
- the cleaned query (lower case, punctuation out; runs of 4+ digits and email-like text
  removed);
- the cuisine filter, how many kitchens were found and how many were open, and the hour and
  weekday in Pakistan time.

There is **no user, device or IP column**, and no exact point. Rows are kept 26 weeks.

**Nightly (02:45 PKT)** `demand_cells` is rebuilt for this week and last, per week (Monday),
city and cell:

- dimensions `all`, per cuisine and per query, each for the whole day and per hour;
- `searches`, `zero_results`, `closed_results` (found kitchens, none open) and `orders`
  dropped in the cell.

| Route | |
|---|---|
| `GET /food/vendor/demand-map?cuisineId&hour&week` | Your city's cells: `{ geohash6, center, bounds, searches, zeroResultShare, closedShare, unmetSearches, orders, distanceKm, inYourZone }`, most unmet first. Also `topQueries` (city-wide, unmet first), `weeks` (the last 8 with a cell to show; the default `week` is the newest of them), `k: 5` and `hidden`. |
| `GET /food/vendor/demand-curve?weeks` (4–26, default 8) | Orders per weekday (0 = Sunday) × hour: `own: { orders, peaks }`, and `area: { kitchens, orders, perKitchen, peaks }` — the city's other kitchens sharing a cuisine with you, **only when there are at least 3** (else `null` with `areaNote`). |
| `GET /admin/food/demand-map?city&cuisineId&hour&week` · `GET /admin/food/demand-map/cities` | The platform view (same threshold). |

**k = 5:** a cell, query or hour with fewer than 5 searches is never returned; `hidden` only
counts them.

## 26. Menu engineering and experiments

**Matrix** — `GET /food/vendor/kitchen/menu-engineering` (the last 30 days of accepted-onward
orders):

- *Popular* = quantity ≥ the median; *profitable* = contribution margin (price − recipe cost,
  weighted by the sizes sold) ≥ the median.
- Both medians are over the dishes that have a recipe card.
- Quadrants and actions: **Star** (`feature`), **Plowhorse** (`reprice`), **Puzzle**
  (`redescribe_or_bundle`), **Dog** (`remove`). Each item carries `quadrant`, `action`,
  `label` and `advice`, plus `price`, `cost`, `foodCostPct`, `qty`, `margin`.
- Dishes without a card are under `needsRecipe` ("Add a recipe card to analyse").
- The rules are pure: `kitchen/engineering/menu-engineering.ts`.

**Experiments** — `/food/vendor/kitchen/experiments`:

| Route | |
|---|---|
| `POST` | `{ itemId, days (3–60), startsOn? (today; at most 7 days back), notes? }`. One running experiment per dish (`409 CONFLICT`). |
| `GET ?status=planned\|running\|completed\|cancelled` · `GET /:id` | |
| `PATCH /:id` `{ endsOn?, notes? }` | |
| `POST /:id/end` | End early: the result through yesterday is kept (`409` before it has started). |
| `DELETE /:id` | Cancel. |

The `result` (live while running, stored once by the kitchen nightly job after the last day)
contains:

- `days`, `sold` and `itemDaily`;
- `categoryMedianDaily` (the median of the category's other dishes) and
  `salesIndex = itemDaily ÷ that median`;
- `forecast`, `vsForecast`, `foodCostPct`, `margin` and the target;
- `recommendation` and `reasons`:
  - **keep** — `salesIndex ≥ 1` and food cost on target;
  - **drop** — `salesIndex < 0.5`, unless it beat its forecast (≥ 0.8);
  - **adjust** — anything else;
  - `null` before 3 days.

## 27. Rider batching

`GET /food/vendor/riders/suggest?orderId` adds `batchWith`. It lists other **ready, unassigned
delivery** orders of the same kitchen that pass both tests:

- their drop is **≤ 2 km** from this order's drop;
- the bearing from the kitchen differs by **≤ 45°**.

Each entry is `{ orderId, code, dropsApartKm, bearingDiff, extraKm, dropSequence }`.
`extraKm` is what the second drop adds to the trip, nearest drop first. The list is sorted
by `extraKm`. Assignment stays manual. The geometry is `common/geo/bearing.ts` (haversine and
initial bearing).

## 28. Error codes and notifications added in 5B

| Code | Status | When |
|---|---|---|
| `TIFFIN_FULL` | 409 | No seat on the plan (subscribe or approve). |
| `TIFFIN_SKIP_CUTOFF_PASSED` | 409 | Skip or unskip after the date's cut-off. `details.date`. |
| `CATERING_QUOTE_EXPIRED` | 409 | Accepting a quote past `validUntil`. |
| `INVALID_TRANSITION` (reused) | 409 | An older quote version (`details.latestVersion`), a hygiene verify that isn't pending, a finished experiment. |
| `SLOT_INVALID` (reused) | 400 | An iftar window taken only as pre-orders (`details.iftarPreorderOnly`). |
| `CONFLICT` (reused) | 409 | A second running experiment for a dish. |

The notifications:

- Tiffin: `food.tiffin.approved` / `declined` / `ended` / `payment_rejected` (customer);
  `kitchen.tiffin.requested` / `payment_proof` / `orders` (vendor).
- Catering: `food.catering.quoted` / `declined` / `confirmed` / `expired` /
  `advance_rejected` (customer); `kitchen.catering.requested` / `accepted` / `advance`
  (vendor).
- Story: `kitchen.story` (hygiene verified or revoked, signature removed).

## 29. Scheduled jobs added in 5B

| Job | When | What |
|---|---|---|
| `growth-tiffin` | every 5 min | Tiffin orders for days whose cut-off passed (once per subscription and day); catering event-day orders (once) and expiry. |
| `growth-daily` | 00:10 PKT | Tiffin period rollover; pauses that ended. |
| `growth-demand` | 02:45 PKT | `demand_cells` for this week and last (rebuilt); search events older than 26 weeks deleted. |
| `kitchen-nightly` step `experiments` | 02:30 PKT | Experiments past their last day → completed, the result stored once. |

## 30. Decisions in 5B (adaptations)

- **Tiffin pause is skips.** A pause turns every open day up to `until` into a skip, so the
  cut-off rule is the same for both.
- **System-written orders use the shared writer and are accepted as `system`**
  (`placed>accepted` allows `system`), so stock is deducted once, as for any order.
- **Payment methods `subscription` and `catering`** are written only by the system;
  customers choose from `cod`, `transfer` and `pay_at_pickup` as before.
- **Ramadan hours are a per-date override in the open-state code**, not stored hours, so
  removing or editing the event changes the hours at once. Iftar pre-order-only is enforced by
  the checkout planner.
- **The hygiene status is null until the checklist is complete** (the spec's enum has only
  `self_declared | verified`). Staff verification records `verified_method` and
  `verified_note`.
- **Signature moderation** keeps `signature_removed_at` / `signature_removed_reason` on the
  card.
- **Demand rows carry `kind` (home, list, search)**. The city is the nearest kitchen's (no
  reverse geocoding). The geohash matches PostGIS `ST_GeoHash`.
- **The area curve needs 3 other kitchens**, so no single competitor's hours can be read off
  it.
- **The kitchen story video is a `kitchen_video` upload** (files never pass through the API;
  outside links are refused like any foreign URL).
- **Menu engineering is per dish.** Sizes are folded in by the quantity sold of each.
