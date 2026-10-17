# MetroMatrix API — Chunk 4 contract (Food Court)

This file is the contract the Food Court app chunk is built from. Everything in it is
enforced by the e2e suite:

- `test/food-*.e2e-spec.ts`;
- the release gate `test/qa-matrix-food.e2e-spec.ts` (28 rows).

The live schema is at `GET /api/docs-json`; Swagger UI is at `/api/docs` where it is enabled.
The conventions in `docs/API_AUTH.md` (envelope, tokens, `X-Request-Id`) all apply. The
realtime channel is §5. Runnable flows: `npm run postman:food` and `npm run socket:food`.

**Base URL:** `https://<host>/api/v1`. Routes live under:

| Who | Prefix | Account |
|---|---|---|
| Discovery (signed out works) | `/food` | — |
| Customer | `/food/cart`, `/food/checkout`, `/food/orders`, `/food/favourites` | role `customer`, verified email |
| Vendor | `/food/vendor` | role `partner`, food business **approved** and the vendor's brand + branch |
| Rider | `/food/rider` | role `rider` (a vendor-issued username), rider `active` |
| Staff | `/admin/food` | `admin` / `super_admin` (TOTP) |

**Zero commission, and MetroMatrix never holds money.** Customers pay the vendor directly:
cash on delivery, pay at pickup, or a transfer to the vendor's own Raast / JazzCash /
Easypaisa / bank account. **The only fee a customer ever sees is the vendor's own delivery
fee** — every total is `subtotal − discount + deliveryFee`, and the database refuses any
other line. Vendor screens say **recorded** sales, never "earnings". There is no wallet,
payout, commission, service charge or platform fee.

**Vendors deliver themselves.** A vendor gives its riders accounts (the Rider view, live
tracking) or marks an order "handed to own rider" with no account.

**Free today, subscription-ready.** Every vendor is on the `community` plan (Rs 0, no
expiry). Limits and entitlements come from `src/modules/plans/plan-config.ts` (ported from
FinMatrix); nothing is paywalled now. See `docs/SUBSCRIPTIONS_LATER.md`.

**Money is whole rupees, computed by the server.** Prices sent by a client are ignored.
Percent discounts round down.

**Times.** Instants are ISO-8601 UTC (`2026-10-17T21:01:56.053Z`), except schedule times —
`scheduledFor` and pre-order slots — which carry the branch's offset
(`2026-10-23T13:00:00.000+05:00`). Labels ("Open until 2:00 AM", "Opens tomorrow 12:00 PM",
"28–38 min", "Fri 23 Oct · 1:00 PM") are built by the server in the branch's timezone.
Insights days are branch-local days.

---

## 1. Conventions

| Rule | What it means for the app |
|---|---|
| Envelope | `{ success: true, data }` or `{ success: false, error: { code, message, details? } }`. Branch on `error.code`. |
| Lists | `data: { items, total, page, pageSize }`, `?page=1&pageSize=20` (max 100). |
| One brand, one branch | Each approved food business has exactly one brand and one branch, created on approval. **The vendor id in every API is the brand id.** No endpoint creates a second (`PlanService` limits `brands: 1`, `branches: 1` back this up). |
| Vendor routes | `403 FORBIDDEN` (not a partner), `403 BUSINESS_NOT_APPROVED` / `BUSINESS_SUSPENDED`, `403 WRONG_SERVICE` (a store or doctor partner). |
| Rider routes | `403 RIDER_INACTIVE` with `details.status` (`inactive`, `on_leave`, `plan_locked`) or `403 BUSINESS_SUSPENDED` (the vendor). Deactivation signs the rider out. |
| Isolation | Another customer's order, another vendor's order, rider, promotion or review, another rider's delivery: **`404 NOT_FOUND`**, never 403. |
| Idempotency | `POST /food/checkout` **requires** `Idempotency-Key` (a fresh UUID per attempt; reuse it for retries). Missing: `400 IDEMPOTENCY_KEY_REQUIRED`. A repeat replays the first response; one that arrives while the first is running: `409 IDEMPOTENCY_IN_PROGRESS`. |
| Rate limits | Discovery reads 600/min per address; checkout 10/min; sign-in 5/min. Over: `429 RATE_LIMITED`. |
| Uploads | `POST /media/sign-upload { purpose }`, then send the Cloudinary `secure_url`. Food purposes: `food_branding` (logo, cover), `menu_item` (dish photos). Reused: `review_photo`, `payment_proof`, `banner` (staff). A URL outside your own folder is refused (`400`). |
| Sign-in | Riders sign in on the **partner** portal with `{ identifier: "<username>", password, portal: "partner" }` (see `docs/API_AUTH.md`). Vendor owners use their email. |

---

## 2. Shared shapes

### `VendorCard` (`GET /food/vendors`, home sections, search)

```json
{
  "id": "feb5eee7-842f-4775-a4e7-7a4271644db2",
  "slug": "qandeel-karahi-house",
  "name": "Qandeel Karahi House",
  "tagline": "Coal-fired karahi and BBQ · demo vendor (fictional)",
  "logoUrl": "https://…", "coverUrl": "https://…",
  "brandColor": "#9A3412", "onBrandColor": "#FFFFFF",
  "cuisines": [{ "name": "Pakistani", "slug": "pakistani" }, { "name": "Karahi", "slug": "karahi" }],
  "priceLevel": 2,
  "ratingAvg": 4.44, "ratingCount": 9,
  "isHomeKitchen": false, "isFeatured": false, "isNew": false,
  "distanceKm": 1.2,
  "etaRange": { "min": 34, "max": 44, "label": "34–44 min" },
  "deliveryFee": 99, "minOrder": 500, "freeDeliveryOver": null,
  "dealLabel": "10% off over Rs 3,000",
  "fulfilment": { "delivery": true, "pickup": true },
  "preorderOnly": false,
  "openState": { "open": false, "paused": false, "label": "Opens 12:00 PM", "opensAt": "2026-10-18T07:00:00.000Z" }
}
```

- `etaRange`: `prep + busy extra + ceil(km ÷ 22 × 60) + 5` minutes, shown as a 10-minute
  range. Pickup ("ready in") is prep (+ busy) only.
- `deliveryFee` / `minOrder`: the fee band that contains the distance. `deliveryFee` is 0
  when an automatic free-delivery deal with no minimum is live.
- `isNew`: went live in the last 30 days. `dealLabel`: the best live automatic deal.
- `openState.label`: "Open until 2:00 AM" · "Opens 6:00 PM" · "Opens tomorrow 12:00 PM" ·
  "Opens Thu 10:00 AM" · "Closed" · the vendor's pause message.

### `VendorPage` (`GET /food/vendors/:slugOrId?lat&lng`)

A `VendorCard` plus:

| Field | Notes |
|---|---|
| `paused`, `pauseMessage` | A paused vendor is **hidden from lists**, but its own page still opens with the message. |
| `location` | `{ addressLine, area, city, lat, lng, phone }` |
| `delivery` | `{ available, outOfZone, fee, minOrder, etaRange }` for the point given; `null` without `lat`/`lng`. |
| `pickup` | `{ readyIn: { min, max, label } }`, or `null` when the vendor doesn't offer pickup. |
| `acceptsCod` | |
| `deals` | Every live automatic deal: `[{ id, title, label, freeDelivery }]`, best first. |
| `ratingSummary` | `{ ratingAvg, ratingCount, distribution: { "5": n, …, "1": n }, topTags: [{ tag, count }], recent: [Review ×3] }` |
| `menu` | Categories in order: `{ id, name, availableFrom, availableTo, availableNow, items: [MenuCard] }`. Items 86'd today and dishes not on today's weekly menu are left out. |
| `popular` | Up to 6 `MenuCard`s by `sold30d`. |

`MenuCard`: `{ id, name, description, photoUrl, tags, isDeal, serves, fromPrice, hasVariants, hasOptions, available, unavailableReason, soldOut, remainingToday, remainingLabel, sold30d }`.
`fromPrice` is the cheapest size. `remainingLabel` is "6 left today" when ≤ 10 portions remain.

### `ItemSheet` (`GET /food/items/:id`)

```json
{
  "id": "cc89cc77-…", "name": "Chicken Tikka Pizza", "basePrice": 950, "fromPrice": 950,
  "available": true, "unavailableReason": null, "remainingToday": null,
  "variants": [
    { "id": "c959659b-…", "name": "Small 8\"", "price": 950, "groupIds": ["9941b0a3-…", "3ddee84c-…"] },
    { "id": "70ca6941-…", "name": "Medium 12\"", "price": 1650, "groupIds": ["9941b0a3-…", "3ddee84c-…"] }
  ],
  "groups": [
    { "id": "9941b0a3-…", "name": "Crust", "minSelect": 1, "maxSelect": 1, "required": true, "variantId": null,
      "options": [{ "id": "c7f6051e-…", "name": "Hand-tossed", "priceDelta": 0, "isDefault": true, "available": true }] },
    { "id": "3ddee84c-…", "name": "Extra toppings", "minSelect": 0, "maxSelect": 3, "required": false, "variantId": null,
      "options": [{ "id": "634a449f-…", "name": "Extra cheese", "priceDelta": 180, "isDefault": false, "available": true }] }
  ]
}
```

Option groups are **reusable** across dishes. A group with `variantId` applies to that size
only (`variants[].groupIds` lists what applies). `unavailableReason`: `unavailable` (86'd or
until a time), `not_today` (weekly menu), `outside_hours` (category window), `sold_out`
(today's portions), `not_on_menu`.

### `Cart` (`GET /food/cart` and every cart write)

`{ empty, vendor, fulfilment, scheduledFor, lines: [CartLine], itemCount, subtotal, warnings, issues }`.
`CartLine`: `{ id, itemId, name, photoUrl, variant, options: [{ id, name, group, priceDelta }], quantity, unitPrice, lineTotal, notes, priceChanged, error }`.
The cart is re-priced on every read. `warnings` lists what checkout would refuse (closed,
below minimum, unavailable line…) and `PRICE_CHANGED`; nothing blocks until checkout.

### `Preview` (`POST /food/cart/preview`)

Exactly what checkout would charge (the same code computes both):

```json
{
  "ok": true, "issues": [], "warnings": [],
  "vendor": { "id": "c678e699-…", "name": "Sahil Tikka & Pizza Oven", "openState": { "open": true, "label": "Open until 3:00 AM" } },
  "fulfilment": "delivery", "scheduledFor": null,
  "lines": [{ "name": "Chicken Tikka Pizza", "variant": { "name": "Small 8\"" },
              "options": [{ "name": "Thin crust", "group": "Crust", "priceDelta": 0 }, { "name": "Extra cheese", "group": "Extra toppings", "priceDelta": 180 }],
              "quantity": 1, "unitPrice": 1130, "lineTotal": 1130, "notes": "Well done, please", "error": null }],
  "totals": { "subtotal": 1130, "discount": 0, "deliveryFee": 120, "total": 1250 },
  "deal": null, "minOrder": 600, "shortfall": 0, "distanceKm": 0.9,
  "eta": { "min": 28, "max": 38, "label": "28–38 min" },
  "payment": { "method": "cod", "available": { "cod": true, "pay_at_pickup": false, "transfer": true }, "codLimit": 12000,
               "accounts": [{ "kind": "bank", "accountTitle": "…", "accountNumber": "PK70MEZN…", "bankName": "…" }] }
}
```

`totals` always has exactly these four keys. `issues[0]` is what checkout would answer.

### `CustomerOrder` (`GET /food/orders/:code`, checkout, customer actions, `order.updated`)

```json
{
  "id": "94c0fb45-…", "code": "FC-NBNWXT",
  "status": "placed", "statusLabel": "Waiting for the restaurant",
  "fulfilment": "delivery", "scheduledFor": null,
  "placedAt": "2026-10-17T21:01:56.053Z", "acceptBy": "2026-10-17T21:06:56.053Z",
  "vendor": { "id": "c678e699-…", "name": "Sahil Tikka & Pizza Oven", "slug": "…", "logoUrl": "…", "phone": "02135870326",
              "location": { "addressLine": "…", "area": "Clifton Block 4", "city": "Karachi", "lat": 24.8138, "lng": 67.0299 } },
  "items": [{ "name": "Chicken Tikka Pizza", "variant": "Small 8\"", "options": [{ "name": "Thin crust", "group": "Crust", "priceDelta": 0 }],
              "quantity": 1, "unitPrice": 1130, "lineTotal": 1130, "notes": "Well done, please" }],
  "totals": { "subtotal": 1130, "discount": 0, "deliveryFee": 120, "total": 1250 },
  "deal": null,
  "payment": { "method": "cod", "status": "cod_pending", "payBy": null, "accounts": null, "reference": null, "proofUrl": null,
               "rejectedReason": null, "instructions": "Pay Rs 1,250 in cash when your order arrives." },
  "address": { "fullName": "Omar Siddiqui", "phone": "+923332190104", "line1": "…", "area": "Clifton Block 5", "city": "Karachi",
               "building": null, "floor": null, "riderInstructions": "Gate 2, call on arrival", "lat": 24.82, "lng": 67.035 },
  "distanceKm": 0.9, "cutlery": false, "note": null,
  "eta": { "minutes": 38, "promisedAt": "2026-10-17T21:39:56.053Z" },
  "rider": null, "handedToExternal": false, "cancelledBy": null, "cancelReason": null,
  "timestamps": { "acceptedAt": null, "preparingAt": null, "readyAt": null, "pickedUpAt": null, "deliveredAt": null, "cancelledAt": null },
  "events": [{ "kind": "status", "from": null, "to": "placed", "actorRole": "customer", "note": null, "at": "…" }],
  "canCancel": true, "canReview": false, "canReorder": false
}
```

- `rider` (once assigned): `{ name, phone, vehicle, step, locationLive, lastGeo, at }`; `lastGeo`
  is `null` unless the location is live (last 2 minutes).
- `events` is the whole history, in order: `kind` `status` / `payment` / `rider` (rider
  steps) / `note`.
- Transfer orders carry `payment.accounts` (the vendor's accounts at checkout) and `payBy`.

### `BoardCard` (`GET /food/vendor/orders`, `board.sync`, `order.new`)

```json
{ "id": "94c0fb45-…", "code": "FC-NBNWXT", "status": "placed", "statusLabel": "Waiting for the restaurant",
  "fulfilment": "delivery", "scheduledFor": null, "placedAt": "…", "acceptBy": "…", "promisedAt": "…",
  "total": 1250, "payment": { "method": "cod", "status": "cod_pending" },
  "itemCount": 1, "itemsSummary": "1× Chicken Tikka Pizza", "customerName": "Omar Siddiqui",
  "riderId": null, "handedToExternal": false }
```

`GET /food/vendor/orders/:id` is a `CustomerOrder` plus `customer: { name, phone }`,
`codCollected`, and `actions: { status: [...], payment: [...] }` — the moves the vendor can
make now.

### `RiderOrder` (`GET /food/rider/orders`, rider steps)

```json
{ "id": "94c0fb45-…", "code": "FC-NBNWXT", "status": "ready", "riderStep": "assigned",
  "nextSteps": ["accepted_by_rider", "picked_up", "declined"],
  "pickup": { "name": "Sahil Tikka & Pizza Oven", "phone": "…", "addressLine": "…", "area": "…", "city": "…", "lat": 24.8138, "lng": 67.0299 },
  "drop": { "name": "Omar Siddiqui", "phone": "+923332190104", "line1": "…", "building": null, "floor": null,
            "riderInstructions": "Gate 2, call on arrival", "lat": 24.82, "lng": 67.035 },
  "items": [{ "name": "Chicken Tikka Pizza", "variant": "Small 8\"", "options": ["Thin crust", "Extra cheese"], "quantity": 1 }],
  "itemCount": 1, "cutlery": false, "note": null,
  "payment": { "method": "cod", "status": "cod_pending" }, "total": 1250, "cashToCollect": 1250, "codCollected": null,
  "readyAt": "…", "promisedAt": "…" }
```

### `Tracking` (`GET /food/orders/:code/tracking`)

```json
{ "code": "FC-NBNWXT", "status": "on_the_way", "statusLabel": "On the way", "fulfilment": "delivery",
  "eta": { "promisedAt": "…", "minutesLeft": 40 },
  "branch": { "name": "Sahil Tikka & Pizza Oven", "phone": "…", "lat": 24.8138, "lng": 67.0299 },
  "drop": { "lat": 24.82, "lng": 67.035 },
  "rider": { "name": "Asif Baloch", "phone": "+92306…", "vehicle": "bike", "step": "picked_up", "locationLive": true,
             "lastGeo": { "lat": 24.817, "lng": 67.033 }, "at": "…" },
  "handedToExternal": false, "updatedAt": "…" }
```

### `Slots` (`GET /food/vendors/:idOrSlug/slots`)

```json
{ "timezone": "Asia/Karachi", "preorderOnly": true, "usesSlots": true,
  "slots": [{ "slotId": "2d2aae2b-…", "startsAt": "2026-10-23T13:00:00.000+05:00", "cutoffAt": "2026-10-23T01:00:00.000+05:00",
              "label": "Fri 23 Oct · 1:00 PM", "maxOrders": 12, "remaining": 12, "full": false }] }
```

### `Review`

`{ id, author (first name), foodRating, deliveryRating, tags, text, photos, vendorReply, repliedAt, createdAt }`.
Tags: `tasty`, `hot_and_fresh`, `good_portion`, `well_packed`, `on_time`, `polite_rider`, `value_for_money`.

---

## 3. State machines

### Order status (`src/modules/food/orders/food-order-status.ts`)

```
placed ──vendor accepts (ETA)──▶ accepted ──▶ preparing ──▶ ready ──rider / own rider──▶ on_the_way ──▶ delivered
  │                                                          └──(pickup) collected at the counter──▶ picked_up
  ├──▶ rejected        (vendor, with a reason)
  ├──▶ auto_rejected   (system: no answer by accept_by)
  └──▶ cancelled       (customer while placed; system: unpaid transfer; admin)
accepted | preparing | ready ──vendor (reason)──▶ cancelled
```

| From → to | Who | Notes |
|---|---|---|
| placed → accepted | vendor | `{ etaMinutes }` (5–180) sets `promisedAt`. |
| placed → rejected | vendor | `{ reason }` |
| placed → auto_rejected | system | At `accept_by` = placed + the branch's `autoRejectMinutes` (3–10, default 5). A nudge goes 2 minutes before. |
| placed → cancelled | customer, system, admin | The customer can cancel **only while placed**; afterwards `409 INVALID_TRANSITION` ("call them"). |
| accepted → preparing | vendor | A transfer order must be `paid` first when the vendor requires it (`transferConfirmBeforePrep`, default on): else `409 PAYMENT_NOT_CONFIRMED`. |
| accepted / preparing → cancelled | vendor, admin (accepted: also system) | `{ reason }` |
| preparing → ready | vendor | |
| ready → on_the_way | rider (`picked-up`), vendor (`handed-external`) | Delivery only. Needs an assigned rider or "own rider" (`handedToExternal: true`). |
| ready → picked_up | vendor | Pickup only. |
| ready → cancelled | vendor, admin | A pickup never collected. |
| on_the_way → delivered | rider, vendor | COD records `codCollected` (≤ total; default the total). |

Any other move: `409 INVALID_TRANSITION { from, to, allowed }`. A concurrent change gives the
same code ("This order just changed — refresh"). **Every cancel (rejected, auto-rejected,
cancelled) gives back today's portions and the promotion use**, settles the payment and frees
the rider.

### Payment status (`orders/food-payment-status.ts`)

| Method | Path |
|---|---|
| `cod` | `cod_pending → paid` on delivered |
| `pay_at_pickup` | `unpaid → paid` on picked_up |
| `transfer` | `awaiting_transfer → proof_submitted → paid` (vendor confirms) · rejected: `proof_submitted → awaiting_transfer` (`rejectedReason`, 10 more minutes) · the vendor may also confirm straight from `awaiting_transfer` |
| Cancelled | before paying → `void`; after paying → `refund_due → refunded` (the vendor refunds off-platform) |

`pay_by` = placed + 10 minutes. A transfer still `awaiting_transfer` at `pay_by` (status
placed or accepted) is cancelled by the system and both sides are told.

### Rider on an order (`riders/rider-steps.ts`; each step is an order event `kind = rider`)

```
assigned → accepted_by_rider → arrived_at_branch → picked_up → arrived_at_customer → delivered
   └───────────────┴──────────────────┴──▶ declined (reason; the order goes back to the vendor, unassigned)
```

Accepting and "arrived" are courtesies: `picked_up` is allowed straight from `assigned`. It
needs the order `ready` (else `409 INVALID_TRANSITION`) and moves it to `on_the_way`.

---

## 4. Endpoints

### 4.1 Discovery (public; optional auth)

| Method | Path | Notes |
|---|---|---|
| GET | `/food/home?lat&lng` | `{ coverage: { delivering, message, pickupNearby }, cuisines, banners, orderAgain (signed in), offers, homeKitchens, topRated, fastest, newOnFoodCourt, freeDelivery }`. Far from every vendor: `message: "Not delivering here yet"`. |
| GET | `/food/vendors?lat&lng` | **Required** `lat`/`lng`. Filters: `q` (vendor, cuisine or dish), `cuisine` (slug or id), `freeDelivery`, `offers`, `minRating`, `pickup` (vendors you can collect from within 25 km, whatever their zone), `homeKitchen`, `openNow`, `priceLevel` (1–3). `sort=recommended` (default) · `distance` · `rating` · `delivery_time` · `delivery_fee`. Open vendors come first in every sort. Paused and out-of-zone vendors are left out. |
| GET | `/food/vendors/:slugOrId?lat&lng` | `VendorPage`. Unknown, not live or suspended: `404`. |
| GET | `/food/vendors/:id/reviews` | Visible reviews, newest first (paged). |
| GET | `/food/vendors/:idOrSlug/slots` | `Slots` (home kitchens with pre-order slots). |
| GET | `/food/items/:id` | `ItemSheet`. |
| GET | `/food/search?q&lat&lng` | `{ vendors: [VendorCard], dishes: [{ vendor: VendorCard, items: [{ id, name, photoUrl, fromPrice, tags }] }] }` — "karahi" finds dishes grouped by the vendor that cooks them. |
| GET | `/food/cuisines` | |

### 4.2 Customer

| Method | Path | Body / notes |
|---|---|---|
| GET | `/food/cart` | `Cart` (priced now; the default address gives the fee). |
| DELETE | `/food/cart` | `{ cleared: true }` |
| PATCH | `/food/cart` | `{ fulfilment?: "delivery" \| "pickup", scheduledFor?: ISO \| null }`. A time that can't be used: `400 SLOT_INVALID`, `409 SLOT_FULL` or `409 VENDOR_CLOSED` (and it isn't kept). |
| POST | `/food/cart/items[?replace=true]` | `{ vendorId, itemId, variantId?, optionIds?, quantity (1–50), notes? }` → `201 Cart`. Another vendor in the cart: `409 CART_OTHER_VENDOR { currentVendor, itemCount }`; `?replace=true` starts a new cart. Bad choices name the item and group: `400 OPTION_REQUIRED` / `OPTION_LIMIT` / `OPTION_INVALID`. `409 ITEM_UNAVAILABLE`, `409 PORTIONS_SOLD_OUT { remaining }`. The same choice again adds to the line. |
| PATCH | `/food/cart/items/:id` | `{ quantity?, variantId?, optionIds?, notes? }` (re-validated) |
| DELETE | `/food/cart/items/:id` | |
| POST | `/food/cart/preview` | `{ addressId?, promoCode?, paymentMethod?, cutlery?, note?, building?, floor?, riderInstructions? }` → `Preview` (200 even when not ok). |
| POST | `/food/checkout` | Same body with `paymentMethod` required, **plus `Idempotency-Key`** → `201 CustomerOrder`. Refusals are `issues[0]`, with every issue in `details.issues`. |
| GET | `/food/orders?status=active\|past` | Paged order cards `{ code, status, statusLabel, vendor, itemCount, total, placedAt, scheduledFor }`. |
| GET | `/food/orders/:code` | `CustomerOrder` |
| GET | `/food/orders/:code/tracking` | `Tracking` |
| POST | `/food/orders/:code/cancel` | `{ reason? }` — only while placed. |
| POST | `/food/orders/:code/payment-proof` | `{ paymentRef, proofUrl? }` (a `payment_proof` upload) → `proof_submitted`. |
| POST | `/food/orders/:code/review` | `{ foodRating (1–5), deliveryRating? (delivery orders), tags?, text?, photos? (≤ 4 review_photo uploads) }` → `201 Review`. Once, after delivered or picked up: `409 REVIEW_NOT_ALLOWED` / `REVIEW_EXISTS`. |
| POST | `/food/orders/:code/reorder` | `{ cart: Cart, dropped: [{ name, reason, message }], priceChanges: [{ name, was, now }] }` — the cart rebuilt at today's menu and prices. |
| GET | `/food/favourites` | `{ items: [{ id, slug, name, logoUrl, coverUrl, ratingAvg, ratingCount, openState, savedAt }] }` |
| POST / DELETE | `/food/favourites/:vendorId` | `{ vendorId, favourite }` |

**Checkout, in one transaction:** re-check the zone, open state (or the scheduled time and
slot capacity), every line, today's portions (atomic: the last portion goes to one checkout —
`409 PORTIONS_SOLD_OUT`), the best promotion (atomic use count — `409 PROMO_LIMIT_REACHED`),
the minimum (`400 BELOW_MIN_ORDER { minOrder, subtotal, shortfall }`), the payment method
(`400 PAYMENT_METHOD_UNAVAILABLE`) and the COD limit (`400 COD_LIMIT_EXCEEDED { limit, total }`).
A delivery address must have a map pin (`400 ADDRESS_LOCATION_REQUIRED`) inside the zone
(`400 OUT_OF_ZONE { distanceKm, maxRadiusKm }`). Closed now: `409 VENDOR_CLOSED { opensAt, label }`
— schedule instead. Paused: `409 VENDOR_PAUSED`. Pre-order-only kitchens need a slot
(`400 SLOT_INVALID`). The vendor is told after the commit (high-priority push and `order.new`).

**Scheduling:** `scheduledFor` is at least `max(30, prep)` minutes ahead and at most 7 days,
inside opening hours. A vendor with pre-order slots takes scheduled orders only at a slot's
start, before its cutoff, up to `maxOrders`. Today's portions apply to orders for today only.

**Promotions:** one per order — the best for the customer among the live automatic deals and
the code typed (`PROMO_INVALID`, `PROMO_EXPIRED`, `PROMO_LIMIT_REACHED` for a code that can't
be used). Kinds: `percent_off_order`, `percent_off_items`, `flat_off`, `free_delivery` (worth
the delivery fee). Rules: dates, weekdays, a daily window (happy hour), minimum order, max
discount, total and per-customer limits, first order with this vendor. Discounts round down.

### 4.3 Vendor (`/food/vendor`)

| Area | Endpoints |
|---|---|
| Setup | `GET /setup` → `{ subType, items: [{ key, label, required, done }], percent, missing, ready, isLive }` (profile, location, hours, zones, payment, menu; home kitchens: portions or slots, and `food_safety`). `POST /go-live` → `422 PROFILE_INCOMPLETE { missing }` or `422 FOOD_SAFETY_CHECK_REQUIRED` (home kitchens wait for staff's check). |
| Profile | `GET/PATCH /profile` (`name, tagline, logoUrl, coverUrl, cuisineIds, priceLevel, brandColor`; `onBrandColor` is computed). `POST /pause { message? }`, `POST /resume`, `POST /busy { extraMinutes (0–60; 0 clears), until? (≤ 6 h; default 1 h) }`. |
| Settings | `GET/PATCH /settings` (address, `lat`/`lng` together, phone, `prepMinutes`, `acceptsDelivery`, `acceptsPickup`, `acceptsCod`, `codLimit`, `transferConfirmBeforePrep`, `autoRejectMinutes` 3–10, `maxRadiusKm`, `freeDeliveryOver`, `preorderOnly` (home kitchens)). `GET/PUT /hours` — `[{ weekday (0 = Sunday), opensAt, closesAt }]`, several ranges a day; `closesAt ≤ opensAt` runs past midnight; `24:00` allowed; overlaps `400 { conflict }`. `GET/PUT /fee-bands` — `[{ fromKm, toKm, fee, minOrder }]` from 0, contiguous, ≤ 6. `GET/POST /closures`, `DELETE /closures/:id`. |
| Payment accounts | `GET/POST /payment-accounts`, `PATCH/DELETE /payment-accounts/:id` (Raast / JazzCash / Easypaisa / bank, ≤ 4 active). |
| Menu | `GET/POST /menu/categories` (`availableFrom/To` daily window), `PATCH/DELETE /menu/categories/:id`, `PUT /menu/categories/reorder`. `GET/POST /menu/items`, `GET/PATCH/DELETE /menu/items/:id`, `PUT /menu/items/reorder`, `POST /menu/items/:id/duplicate`, `PUT /menu/items/:id/variants`, `PUT /menu/items/:id/option-groups` (`[{ groupId, variantId? }]`). `GET/POST /menu/option-groups`, `GET/PUT/DELETE /menu/option-groups/:id` (reusable; `min ≤ max ≤ options`). |
| Availability | `GET/PATCH /availability` — `{ items: [{ itemId, isAvailable, unavailableUntil? }], options: [{ optionId, isAvailable }] }`. Home kitchens: `GET/PATCH /today` (`[{ itemId, portions }]`, cooking today), `GET/PUT /preorder-slots`, `PUT /weekly-menu` (`[{ itemId, days }]`). |
| Orders | `GET /orders?status=new\|active\|done\|<status>&scheduled`, `GET /orders/:id`, `POST /orders/:id/accept { etaMinutes? }` · `/reject { reason }` · `/preparing` · `/ready` · `/assign { riderId }` · `/handed-external` · `/picked-up` · `/delivered { codCollected? }` · `/cancel { reason }` · `/payment/confirm` · `/payment/reject { reason }`. |
| Riders | `GET/POST /riders` (`{ fullName, phone?, vehicle? }` → `{ rider, credential: { username, password } }` — **the password is shown once**; `409 PLAN_LIMIT_REACHED` past the plan). `GET/PATCH /riders/:id`, `PATCH /riders/:id/status { status: active \| inactive \| on_leave }`, `POST /riders/:id/reset-password` (shown once), `GET /riders/:id/credential` (username only). `GET /riders/suggest?orderId` (on duty; fewest active orders, then nearest **live** location; you choose — nothing is auto-dispatched). `GET /riders/live`. `GET /riders/:id/cash`, `POST /riders/:id/handover { amount, note? }` (≤ what they hold). |
| Promotions | `GET /promotions?state=live\|scheduled\|ended\|inactive`, `POST /promotions`, `GET/PATCH/DELETE /promotions/:id` (delete only if never used), `POST /promotions/:id/deactivate`. Running promotions count against `promotions_active`. |
| Reviews | `GET /reviews?unreplied=true`, `POST /reviews/:id/reply { reply }` |
| Insights | `GET /insights?range=today\|7d\|30d` (or `from`/`to` local dates, ≤ 92 days) → `{ range, note, totals: { orders, completed, recordedSales, averageOrderValue }, days: [{ date, orders, completed, cancelled, recordedSales }], acceptanceRate, autoRejected, avgAcceptSeconds, avgPrepMinutes, onTimeRate, cancelReasons, topItems, repeatCustomers }`. Rates are 0–1 (`null` with no data). |
| Plan | `GET /plan` → `{ planKey, label, priceMinorUnits, currency, limits, usage, entitlements, startedAt, expiresAt, overrides }` |

**Assigning:** delivery orders, accepted to ready, not handed to an own rider. The rider must
be yours (`404`), `active` and on duty (`409 RIDER_NOT_AVAILABLE { reason: off_duty | inactive | on_leave | plan_locked }`).
Reassigning before pickup frees the first rider.

### 4.4 Rider (`/food/rider`)

| Method | Path | Notes |
|---|---|---|
| GET | `/me` | `{ rider, vendor }` |
| PATCH | `/duty` | `{ onDuty }` — only on-duty riders are assigned or share location. |
| POST | `/location` | `{ points: [{ orderId?, lat, lng, heading?, speed?, accuracy?, at? }] }` (≤ 100, oldest first) → `{ accepted }`. Off duty: `409 RIDER_NOT_AVAILABLE`; an order not yours: `409 RIDER_NOT_ASSIGNED`. The REST fallback for the socket. |
| GET | `/orders?scope=active\|history` | `RiderOrder`s |
| GET | `/orders/:id` | `RiderOrder` (another rider's: `404`) |
| POST | `/orders/:id/accept` · `/arrived-branch` · `/picked-up` · `/arrived-customer` | The rider steps. |
| POST | `/orders/:id/decline` | `{ reason }` → `{ declined: true }`; back to the vendor. |
| POST | `/orders/:id/delivered` | `{ codCollected? }` — COD cash (≤ total) goes on your ledger. |
| GET | `/cash` | `{ riderId, balance, entries: [{ kind: cod_collected \| handover \| adjustment, amount, orderCode, note, at }] }` — what you hold for the vendor. |

### 4.5 Staff (`/admin/food`; every write audited)

| Method | Path | Notes |
|---|---|---|
| GET | `/overview` | Live vendors by type, orders today, active orders, acceptance rate and auto-rejects today, top cuisines (7 days), approvals and food-safety checks waiting. |
| GET | `/vendors?type&status=live\|draft\|paused\|suspended&city&q` | Paged. |
| GET | `/vendors/:id` | Profile, settings, hours, zones, setup, plan, menu (read-only), recent orders, rating summary, complaints (≤ 2★). |
| POST | `/vendors/:id/feature` · `/unfeature` | `food.vendor.feature` |
| POST | `/vendors/:id/suspend` · `/reinstate` | `{ reason }`. The business suspension: the vendor is hidden at once; the owner and **every customer with an active order** are told. |
| GET / PATCH | `/vendors/:id/plan` | `{ planKey?, overrides?: { limits?, entitlements? } \| null }` — takes effect immediately; riders beyond a lowered limit become `plan_locked` (a rider mid-delivery keeps the seat). `brands`/`branches` above 1 are refused. |
| POST | `/branches/:id/food-safety-check` | `{ outcome: passed \| failed, note }` (home kitchens; required before go-live). |
| GET | `/orders?code&vendorId&status` · `/orders/:id` | Read-only, with every event (disputes). |
| GET | `/reviews?vendorId&hidden&maxRating` · POST `/reviews/:id/hide { reason }` · `/unhide` | Hidden reviews leave every rating and list. |
| GET/POST | `/cuisines` · PATCH/DELETE `/cuisines/:id` | Delete only when unused (else deactivate). |
| GET/POST | `/banners` · PATCH/DELETE `/banners/:id` | `{ imageUrl (banner upload), title, subtitle?, targetType: vendor \| cuisine \| search, targetId? \| targetQuery?, city? (null = everywhere), startsAt?, endsAt?, sort?, isActive? }`. The home shows live ones whose target still exists. |

Food approvals stay in the Chunk 1 queue (`/admin/businesses`); business views now carry
`subTypeLabel` ("Restaurant", "Cloud kitchen", "Home kitchen").

---

## 5. Realtime (Socket.IO)

One Socket.IO gateway in the API process, namespace **`/food`**, default path `/socket.io`.
State always lives in REST: after a reconnect, read the order (or the board) again.

**Connect** with the access token:

```js
import { io } from 'socket.io-client';
const socket = io('https://<host>/food', { auth: { token: accessToken }, transports: ['websocket'] });
socket.on('connect_error', (err) => { /* err.message: UNAUTHORIZED | TOKEN_REVOKED | ACCOUNT_DISABLED; err.data: { code, message } */ });
```

The token is checked exactly like an HTTP request: signature and audience, the sign-out
denylist, `token_version` and account status. A refused token never connects; a refreshed
token means reconnecting with it.

**Rooms** (joined by the server, never by the client's say-so):

| Room | Who | How |
|---|---|---|
| `branch:{branchId}` | the vendor owner | on connect (then `board.sync`) |
| `rider:{userId}` | an active rider | on connect |
| `order:{orderId}` | the order's customer, its vendor, its assigned rider | `subscribe` |

**Client → server** (each answers with an ack):

| Event | Payload | Ack |
|---|---|---|
| `subscribe` | `{ orderId }` | `{ ok: true, orderId }` or `{ ok: false, code: "NOT_FOUND" }` (not yours) |
| `unsubscribe` | `{ orderId }` | `{ ok: true }` |
| `rider.location` | `{ orderId?, lat, lng, heading?, speed?, accuracy?, at? }` | `{ ok: true }` or `{ ok: false, code }`: `FORBIDDEN` (not a rider), `RIDER_NOT_AVAILABLE` (off duty), `RIDER_NOT_ASSIGNED` (not your order), `VALIDATION_FAILED` |

**Server → client:**

| Event | To | Payload |
|---|---|---|
| `board.sync` | the vendor, on connect | `{ at, orders: [BoardCard] }` — every active order |
| `order.new` | `branch:` | `{ order: BoardCard }` (plus a high-priority push to the owner) |
| `order.updated` | `order:` (customer, rider) | `{ orderId, code, status, order: CustomerOrder }` |
| `order.updated` | `branch:` | `{ orderId, code, status, order: BoardCard }` |
| `order.updated` | `rider:` (the assigned rider, not in the order room) | `{ orderId, code, status, order: CustomerOrder }` |
| `order.payment` | `order:` and `branch:` | `{ orderId, code, status, paymentStatus, paymentMethod }` — proof sent, confirmed, rejected |
| `rider.location` | `order:` | `{ orderId, lat, lng, heading, speed, at }` — at most one per order every 4 s |

Events are sent after the change is committed. One dyno uses the in-memory adapter; several
dynos need the Socket.IO Redis adapter (not provisioned). `npm run socket:food` checks the
whole flow against a running server.

---

## 6. Error codes added in Chunk 4

| Code | HTTP | When |
|---|---|---|
| `VENDOR_CLOSED` | 409 | Closed now or at the scheduled time (`details.opensAt`, `label`). |
| `VENDOR_PAUSED` | 409 | The vendor paused ordering (`details.message`). |
| `OUT_OF_ZONE` | 400 | The drop point is beyond the delivery radius. |
| `BELOW_MIN_ORDER` | 400 | `details.minOrder`, `subtotal`, `shortfall`. |
| `CART_OTHER_VENDOR` | 409 | `details.currentVendor`, `itemCount`; `?replace=true` clears. |
| `ITEM_UNAVAILABLE` | 409 | `details.item`, `reason`. |
| `OPTION_INVALID` / `OPTION_REQUIRED` / `OPTION_LIMIT` | 400 | `details.item`, `group` (and `min` / `max`). |
| `PORTIONS_SOLD_OUT` | 409 | `details.item`, `remaining`. |
| `SLOT_FULL` | 409 | The pre-order slot has no places left. |
| `PROMO_INVALID` / `PROMO_EXPIRED` | 400 | The code can't be used. |
| `PROMO_LIMIT_REACHED` | 409 | Used up (total or per customer). |
| `ADDRESS_LOCATION_REQUIRED` | 400 | Delivery needs an address with a map pin. |
| `FULFILMENT_UNAVAILABLE` | 400 | The vendor doesn't deliver (or offer pickup). |
| `RIDER_NOT_AVAILABLE` | 409 | Off duty, inactive, on leave or plan-locked. |
| `RIDER_NOT_ASSIGNED` | 409 | Location for an order that isn't the rider's. |
| `RIDER_INACTIVE` | 403 | The rider's account isn't active (`details.status`). |
| `PLAN_LIMIT_REACHED` | 409 | `details.key`, `limit`, `used`, `planKey` (or `details.entitlement`). |
| `FOOD_SAFETY_CHECK_REQUIRED` | 422 | A home kitchen before staff's food-safety check. |

Reused: `WRONG_SERVICE`, `COD_LIMIT_EXCEEDED`, `PAYMENT_METHOD_UNAVAILABLE`,
`PAYMENT_NOT_CONFIRMED`, `INVALID_TRANSITION`, `IDEMPOTENCY_KEY_REQUIRED`, `CART_EMPTY`,
`SLOT_INVALID`, `REVIEW_EXISTS`, `REVIEW_NOT_ALLOWED`, `PROFILE_INCOMPLETE`.

---

## 7. Notifications (`type`; `data` is `{ orderId, code }` unless noted)

| Type | To |
|---|---|
| `food.order.new` | vendor (**high-priority push**) |
| `food.order.accepted` · `preparing` · `ready` · `on_the_way` · `rider_arrived` · `delivered` · `picked_up` · `rejected` · `payment_confirmed` · `payment_rejected` | customer |
| `food.order.cancelled` | the other side (customer or vendor); both for unpaid transfers |
| `food.order.auto_rejected` | customer and vendor |
| `food.order.payment_proof` | vendor |
| `food.order.accept_soon` · `food.order.start_cooking` | vendor (high priority): 2 minutes before auto-reject; a scheduled order's start time |
| `food.rider.assigned` (high priority) · `food.rider.unassigned` | rider |
| `food.rider.update` | vendor (rider accepted or declined) |
| `food.review.new` (`{ reviewId }`) | vendor |
| `food.review.reply` (`{ reviewId }`) | customer |
| `food.vendor.suspended` | customers with an active order at a suspended vendor |

---

## 8. Scheduled jobs (`jobs/food-jobs.service.ts`; advisory-locked, idempotent, `JOBS_ENABLED`)

| When | What |
|---|---|
| Every 30 s | Auto-reject orders past `accept_by`; cancel transfers unpaid past `pay_by`. Portions and promotion use come back. |
| Every minute | Scheduled orders: "start cooking" at `scheduled_for − prep − 10 min`; the 2-minute accept nudge. Each once. |
| 00:05 Karachi | Today's portions reset to each dish's daily limit (once per branch-local day); stale busy mode cleared. |
| 03:30 Karachi | Ratings and `sold30d` recomputed (changed rows only); rider location history older than 14 days purged. |

---

## 9. Decisions this contract makes (beyond the brief)

- **The vendor id is the brand id** everywhere. Pause and busy live on the branch.
- **Riders sign in with a username** on the partner portal (`identifier`); their account has
  an undeliverable `<username>@riders.metromatrix.invalid` email that the mailer never sends to.
- **Pickup reach is 25 km** for the pickup filter, whatever the delivery radius.
- **Cloud kitchens are delivery-only** by default.
- **"Unavailable until"** an 86'd dish comes back by itself at that time.
- A **paused** vendor drops out of lists but keeps its page (with the message); a
  **suspended** one disappears entirely.
- **A vendor may cancel a ready order** (a pickup never collected), besides the brief's
  accepted / preparing.
- **Rider steps are a column too** (`food_orders.rider_step`), so a step is validated without
  replaying events; every step is still an event.
- **Promotion usage** is the conditional `used_count` (global) and the customer's live orders
  (per customer); any cancel gives the use back.
- **Scheduled orders** are at least 30 minutes (or the prep time) ahead, at most 7 days.
- **Reviews:** one per order; staff hiding a review recomputes the rating at once.
- **Insights "acceptance rate"** counts orders the vendor had to answer: a customer's own
  cancel while placed is not counted against the vendor.

---

## 10. Demo data (`npm run seed:food`)

Six fictional vendors (`demo.food.<key>@metromatrix.test`, password `SEED_DEMO_PASSWORD`):

| Key | Vendor | Kind | City | Riders |
|---|---|---|---|---|
| `qandeel` | Qandeel Karahi House | restaurant (lunch + dinner, Fri/Sat until 2 am) | Lahore, Gulberg | `qandeel-karahi-house.imran`, `.waqas` |
| `zafran` | Zafran Biryani Kitchen | restaurant (happy hour 3–6 pm) | Lahore, Model Town | — |
| `sahil` | Sahil Tikka & Pizza Oven | restaurant (5 pm–3 am, code `PIZZA20`) | Karachi, Clifton | `sahil-tikka-pizza-oven.asif`, `.danish` |
| `smash` | Smash Theory Burgers | cloud kitchen (delivery only) | Lahore, Cavalry Ground | `smash-theory-burgers.hamza`, `.saad` |
| `rukhsana` | Khala Rukhsana's Kitchen | home kitchen, pre-order only (Fri/Sat/Sun slots) | Karachi, Bath Island | — |
| `farzana` | Farzana's Ghar ka Khana | home kitchen, daily portions, breakfast window | Lahore, Garden Town | — |

Plus six customers (`demo.foodie1…6@metromatrix.test`), 58 dishes, 75 past orders, 48
reviews and three home banners. Every brand is made up and says so; logos are generated
monograms; photos are credited in `src/database/seeds/food/CREDITS.md`.
