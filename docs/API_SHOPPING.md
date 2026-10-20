# MetroMatrix API — Chunk 2 contract (Shopping)

The Shopping app chunk is built from this file. Everything here is enforced by the e2e
suite (`test/shop-*.e2e-spec.ts` and the release gate `test/qa-matrix-shopping.e2e-spec.ts`).
Live schema: `GET /api/docs-json` (Swagger UI at `/api/docs` where enabled). Conventions
from `docs/API_AUTH.md` (envelope, tokens, `X-Request-Id`) all apply.

- **Base URL:** `https://<host>/api/v1` · shopping routes live under `/shop`, partner
  routes under `/shop/partner`, staff routes under `/admin/shop`.
- **MetroMatrix never holds money.** Customers pay each store directly: cash on delivery
  (COD) or a transfer to the store's own account. There is no wallet, payout, commission or
  platform fee anywhere. "Recorded sales" in partner screens is the sum of delivered order
  totals — label it that way, never "earnings" or "balance".
- **Money is whole rupees** (`number`, integer). Percent discounts round **down**. Every
  total is computed by the server; prices sent by a client are ignored.
- **Times** are ISO-8601 UTC. Day boundaries in insights and the daily jobs are Pakistan
  days (`Asia/Karachi`).

---

## 1. Conventions

| Rule | What it means for the app |
|---|---|
| Envelope | `{ success: true, data }` / `{ success: false, error: { code, message, details? } }` — branch on `error.code`. |
| Lists | `data: { items, total, page, pageSize }`; query `?page=1&pageSize=20` (max 100). |
| Optional auth | Catalogue routes work signed out. Send the bearer token when you have one: product cards then carry `isWishlisted`. A bad/expired token on these routes is treated as anonymous (never 401). |
| Customer routes | Role `customer` **with a verified email**, else `403 FORBIDDEN` / `403 EMAIL_NOT_VERIFIED`. |
| Partner routes | Role `partner`, business **approved**, service **shopping**. Others get `403 BUSINESS_NOT_APPROVED`, `BUSINESS_SUSPENDED` or `WRONG_SERVICE` (`details: { required: "shopping", actual: "healthcare" }`). |
| Isolation | A store only ever sees its own rows. Another store's product, variant, order, coupon, return or review is **`404 NOT_FOUND`** — never 403. Same for another customer's cart lines, orders and returns. |
| Checkout idempotency | `POST /shop/checkout` **requires** `Idempotency-Key` (a fresh UUID per attempt; reuse it for retries of the same attempt). Missing → `400 IDEMPOTENCY_KEY_REQUIRED`. A retry with the same key replays the first response; a retry while the first is still running → `409 IDEMPOTENCY_IN_PROGRESS`. A failed attempt releases its key. |
| Stock | Customers see `inStock` / `lowStock` (≤ 3) flags only, never numbers. Partners see exact stock. |
| Rate limits | Catalogue reads: 600/min per client address. Checkout: 10/min. Reports: 10/hour. Others: the global default. `429 RATE_LIMITED`. |
| Uploads | Images go straight to Cloudinary with `POST /media/sign-upload { purpose }`. Shopping purposes: `product_image` (partner), `store_branding` (partner), `review_photo`, `return_photo`, `payment_proof` (customer; PDF allowed), `banner` (admin). The API only accepts URLs inside the caller's own folder for that purpose. |

---

## 2. Shared shapes

### `ProductCard` (every product list)
```json
{
  "id": "1c0e…", "name": "Embroidered lawn kurta", "slug": "embroidered-lawn-kurta",
  "price": 3900, "basePrice": 4500, "salePrice": 3900, "onSale": true,
  "coverUrl": "https://res.cloudinary.com/…/image/upload/v1/…/a1.png",
  "ratingAvg": 4.5, "ratingCount": 12, "inStock": true,
  "isWishlisted": false,
  "store": { "id": "9a7d…", "slug": "lahore-loom", "name": "Lahore Loom" }
}
```
`price` is the product's effective price (`salePrice ?? basePrice`); a variant may add its own
`priceDelta` (see product detail). `isWishlisted` is present only when the caller is signed in.

### `StoreCard`
```json
{
  "id": "9a7d…", "slug": "lahore-loom", "name": "Lahore Loom", "city": "Lahore",
  "tagline": "Hand-finished lawn, khaddar and kurtas",
  "logoUrl": "…", "coverUrl": "…", "brandColor": "#7F1D1D", "onBrandColor": "#FFFFFF",
  "ratingAvg": 4.4, "ratingCount": 31, "isFeatured": true, "productCount": 18
}
```
Draw store-branded surfaces with `brandColor` and put text on them in `onBrandColor`
(white or ink `#16151A`, whichever passes WCAG AA — the server refuses brand colours where
neither does).

### `CartView` (GET /shop/cart and every cart write)
```json
{
  "stores": [{
    "store": { "id": "…", "slug": "lahore-loom", "name": "Lahore Loom", "logoUrl": "…" },
    "isAvailable": true,
    "warnings": [],
    "items": [{
      "id": "cartItemId", "variantId": "…", "productId": "…",
      "productName": "Embroidered lawn kurta", "variantLabel": "M / Maroon", "imageUrl": "…",
      "unitPrice": 3900, "priceAtAdd": 4500, "quantity": 2, "lineTotal": 7800,
      "inStock": true, "lowStock": false, "maxQuantity": 6,
      "warnings": [{ "code": "PRICE_CHANGED", "message": "Price changed from Rs 4500 to Rs 3900.",
                     "details": { "was": 4500, "now": 3900 } }]
    }],
    "subtotal": 7800, "shippingFee": 0, "total": 7800,
    "freeShippingOver": 5000, "amountToFreeShipping": 0
  }],
  "lineCount": 1, "itemCount": 2, "itemsTotal": 7800, "shippingTotal": 0, "grandTotal": 7800,
  "hasWarnings": true,
  "adjusted": null
}
```
- Line `warnings[].code`: `PRICE_CHANGED`, `OUT_OF_STOCK`, `LOW_STOCK` (`details.available`),
  `PRODUCT_UNAVAILABLE` (unpublished/removed product or retired option).
  Store `warnings[].code`: `STORE_UNAVAILABLE` (message = the store's pause message).
- Totals count only lines that can be bought right now; shipping is a preview without coupons.
- `adjusted` (writes only): `{ variantId, requested, quantity, reason: "stock" | "max_per_line" }`
  when the quantity was capped, else `null`.
- Editing a line (PATCH) accepts its current price and clears `PRICE_CHANGED`.

### `CheckoutPlan` (POST /shop/cart/preview)
```json
{
  "ok": false,
  "issues": [],
  "stores": [{
    "storeId": "…", "storeSlug": "lahore-loom", "storeName": "Lahore Loom",
    "paymentMethod": "cod", "couponCode": "LOOM10",
    "items": [{ "cartItemId": "…", "variantId": "…", "productId": "…", "productName": "…",
                "variantLabel": "M", "imageUrl": "…", "unitPrice": 3900, "quantity": 2, "lineTotal": 7800 }],
    "subtotal": 7800, "discount": 780, "shippingFee": 0, "total": 7020,
    "transferVia": [],
    "issues": [{ "code": "DELIVERY_UNAVAILABLE", "message": "Lahore Loom doesn't deliver to Quetta.",
                 "details": { "storeId": "…", "city": "Quetta", "deliveryCities": ["Lahore"] } }],
    "warnings": [{ "code": "PRICE_CHANGED", "message": "…", "details": { "lines": [{ "cartItemId": "…", "was": 4500, "now": 3900 }] } }]
  }],
  "totals": { "itemsTotal": 7800, "discountTotal": 780, "shippingTotal": 0, "grandTotal": 7020 }
}
```
Preview runs exactly the code checkout runs, minus the writes: if `ok` is true and nothing
changes, checkout produces the same numbers. Show `issues` next to their store; `ok: false`
means checkout would fail with the first issue.

### `StoreOrder` (customer view; inside `OrderGroup.storeOrders` and from `/shop/store-orders/:id`)
```json
{
  "id": "…", "code": "MM-7KQ2PX-1", "status": "placed",
  "paymentMethod": "transfer", "paymentStatus": "awaiting_transfer",
  "subtotal": 2500, "discount": 0, "couponCode": null, "shippingFee": 150, "total": 2650,
  "customerNote": null,
  "items": [{ "id": "orderItemId", "productId": "…", "variantId": "…", "productName": "Wool shawl",
              "variantLabel": "Grey", "imageUrl": "…", "unitPrice": 2500, "quantity": 1,
              "lineTotal": 2500, "returnedQty": 0, "reviewed": false, "canReview": false }],
  "payment": {
    "method": "transfer", "status": "awaiting_transfer",
    "payBy": "2026-10-16T09:00:00.000Z", "paidAt": null,
    "paymentRef": null, "proofUrl": null, "rejectedReason": null,
    "accounts": [{ "kind": "bank", "accountTitle": "Transfer Traders", "accountNumber": "PK36MEZN0001234567890123", "bankName": "Meezan Bank" }],
    "refundAmount": null, "refundRef": null, "refundedAt": null
  },
  "shipping": { "courierName": null, "trackingRef": null, "riderName": null, "riderPhone": null },
  "cancelReason": null, "cancelledBy": null, "cancelRequestedAt": null,
  "returnWindowDays": 7, "returnDeadline": null,
  "placedAt": "…", "confirmedAt": null, "packedAt": null, "shippedAt": null,
  "deliveredAt": null, "completedAt": null, "cancelledAt": null,
  "events": [{ "kind": "status", "from": null, "to": "placed", "actorRole": "customer", "note": null, "at": "…" }],
  "store": { "id": "…", "slug": "transfer-traders", "name": "Transfer Traders", "logoUrl": null },
  "can": { "cancel": true, "requestCancel": false, "submitPaymentProof": true, "markReceived": false, "requestReturn": false }
}
```
- `payment.accounts` is the store's active accounts **as they were at checkout** (transfer
  orders only; `null` for COD). Show them with `total` and `payBy` as the payment
  instructions. Editing an account later never changes a placed order.
- Lines are snapshots: name, label, image and price never change after checkout.
- `events` is the timeline, oldest first. `kind`: `status` | `payment` | `note`.
- `can.*` tells the app which buttons to show; the server enforces the same rules.

### `OrderGroup` (checkout response, `GET /shop/orders/:groupCode`)
```json
{
  "id": "…", "code": "MM-7KQ2PX", "placedAt": "…",
  "address": { "label": "home", "fullName": "Ayesha Khan", "phone": "+923124890176", "city": "Lahore",
               "area": "Gulberg III", "line1": "House 12, Street 4", "landmark": null, "lat": null, "lng": null },
  "itemsTotal": 13900, "discountTotal": 900, "shippingTotal": 350, "grandTotal": 13350,
  "storeOrders": [StoreOrder, StoreOrder, StoreOrder]
}
```
Invariants (database CHECKs + tests): `grandTotal = Σ storeOrders.total`, and for each store
order `total = subtotal − discount + shippingFee`, each line `lineTotal = unitPrice × quantity`.

### `PartnerStoreOrder` (`/shop/partner/orders/:id` and every partner order action)
`StoreOrder` without `can`/`store`, plus:
```json
{
  "groupCode": "MM-7KQ2PX",
  "customer": { "name": "Ayesha Khan", "phone": "+923124890176",
                "address": { "city": "Lahore", "area": "Gulberg III", "line1": "House 12, Street 4", "landmark": null, "lat": null, "lng": null } },
  "can": { "moveTo": ["confirmed", "cancelled"] }
}
```
Stores get the delivery contact from the address snapshot — never the customer's email or account.

### `ReturnRequest`
```json
{
  "id": "…", "storeOrderId": "…", "storeOrderCode": "MM-7KQ2PX-1",
  "store": { "id": "…", "name": "Lahore Loom" },
  "customerName": "Ayesha Khan",
  "status": "requested", "reason": "size_issue", "details": "Too tight.", "photos": ["…"],
  "storeNote": null,
  "items": [{ "id": "returnItemId", "orderItemId": "…", "productName": "…", "variantLabel": "M",
              "imageUrl": "…", "unitPrice": 3900, "quantity": 1, "restocked": null }],
  "value": 3900, "refundAmount": null, "refundRef": null,
  "createdAt": "…", "decidedAt": null, "receivedAt": null, "refundedAt": null
}
```
`customerName` appears in partner responses only. `reason`: `wrong_item | damaged |
size_issue | not_as_described | other`.

### `Review`
```json
{
  "id": "…", "productId": "…", "rating": 5, "text": "Lovely glaze.", "photos": ["…"],
  "variantLabel": "Blue", "author": { "name": "Ayesha K.", "avatarUrl": null },
  "storeReply": "Thank you!", "repliedAt": "…", "createdAt": "…"
}
```
Partner/customer responses also carry `productName`, `orderItemId`, `isHidden`.

### `Coupon` (partner)
```json
{
  "id": "…", "code": "EID15", "type": "percent", "value": 15, "minOrder": 0, "maxDiscount": 800,
  "startsAt": "…", "endsAt": "…", "usageLimit": 100, "perUserLimit": 1, "usedCount": 12,
  "isActive": true, "state": "active", "createdAt": "…"
}
```
`state`: `active | scheduled | expired | exhausted | inactive`.

---

## 3. State machines

Every change goes through one service that checks these tables, applies a conditional
update (`… WHERE status = :from`) and writes a timeline event in the same transaction. An
illegal move is **`409 INVALID_TRANSITION`** with `details: { from, to, allowed }`
(`allowed` = what *this actor* may do from `from`).

### Order status (`src/modules/shopping/orders/order-status.ts`)

| From | To | Who | How |
|---|---|---|---|
| — | `placed` | customer | `POST /shop/checkout` |
| `placed` | `confirmed` | store | `POST /shop/partner/orders/:id/confirm` |
| `placed` | `cancelled` | customer | `POST /shop/store-orders/:id/cancel { reason }` |
| `placed` | `cancelled` | store | `…/reject { reason }` or `…/cancel { reason }` |
| `placed` | `cancelled` | system | unpaid transfer past `payBy` (job) |
| `confirmed` | `packed` | store | `…/pack` |
| `confirmed` | `cancelled` | store, system | `…/cancel { reason }` (reason required) |
| `packed` | `shipped` | store | `…/ship { courierName, trackingRef }` or `{ courierName: "self", riderName, riderPhone }`; a **transfer** order must be `paid` → else `409 PAYMENT_NOT_CONFIRMED` |
| `packed` | `cancelled` | store, system | `…/cancel { reason }` |
| `shipped` | `delivered` | store or customer | `…/deliver` · `POST /shop/store-orders/:id/received` |
| `delivered` | `completed` | system | daily job, after `returnWindowDays` with no open return |

- A customer cannot cancel once confirmed: `POST /shop/store-orders/:id/request-cancel
  { reason }` records a `note` event and notifies the store, which decides.
- **Every cancel** restores stock (`cancel` movements), gives the coupon use back, and
  settles the payment (table below).

### Payment status (`src/modules/shopping/orders/payment-status.ts`)

| Method | From | To | Who | How |
|---|---|---|---|---|
| cod | `cod_pending` | `paid` | store | `…/cash-collected` — only once `delivered`/`completed` |
| cod | `cod_pending` | `void` | (cancel) | any cancel |
| transfer | `awaiting_transfer` | `proof_submitted` | customer | `POST /shop/store-orders/:id/payment-proof { paymentRef, proofUrl? }` |
| transfer | `awaiting_transfer` / `proof_submitted` | `paid` | store | `…/payment/confirm` |
| transfer | `proof_submitted` | `awaiting_transfer` | store | `…/payment/reject { reason }` — sets `rejectedReason`; `payBy` becomes at least now + 12 h |
| transfer | `awaiting_transfer` | `void` | (cancel) | any cancel, incl. the unpaid-deadline job |
| transfer | `proof_submitted` | `refund_due` | (cancel) | a cancel after the customer says they paid |
| any | `paid` | `refund_due` | (cancel) | any cancel after payment |
| any | `refund_due` | `refunded` | store | `…/refund { amount, refundRef }` (amount ≤ total; money moves off-platform) |

`payBy` = placed + 24 h. Returns record their own refund (below) and never change the
store order's payment status.

### Return status (`src/modules/shopping/returns/return-status.ts`)

| From | To | Who | How |
|---|---|---|---|
| — | `requested` | customer | `POST /shop/store-orders/:id/returns` — order `delivered`, within `returnWindowDays` of `deliveredAt`, no other open return |
| `requested` | `approved` | store | `POST /shop/partner/returns/:id/approve { note? }` |
| `requested` | `rejected` | store | `…/reject { note }` (required) |
| `approved` | `received` | store | `…/receive { items: [{ returnItemId, restock }] }` — restocked lines write `return_restock` movements; `returnedQty` updated |
| `received` | `refunded` | store | `…/refund { amount, refundRef }` — amount ≤ the returned lines' value |

Open = `requested | approved | received`. Stock moves only at `receive`, exactly once.

---

## 4. Checkout

`POST /shop/checkout` (customer, `Idempotency-Key` required)

```json
{
  "addressId": "…",
  "stores": [
    { "storeId": "…", "paymentMethod": "cod", "couponCode": "LOOM10", "note": "Ring the bell" },
    { "storeId": "…", "paymentMethod": "transfer" }
  ]
}
```
`stores` must name **every store in the cart exactly once** (else `400 CHECKOUT_MISMATCH`,
`details: { missing, unexpected }`). In **one database transaction** the server locks the
cart and the variant rows (in id order), re-validates and re-prices everything (the
preview code), claims each coupon use atomically, writes the order group, one store order
per store with snapshotted lines, decrements stock with movements, and empties the cart.
Any failure rolls back everything. Stores and the customer are notified after commit.

`201` → `OrderGroup`. Errors: the first problem is the error; `details` also lists every
problem (`details.issues` global, `details.stores[{ storeId, issues }]`).

| Code | HTTP | When |
|---|---|---|
| `CART_EMPTY` | 400 | nothing in the cart |
| `NOT_FOUND` | 404 | `addressId` isn't one of the caller's addresses |
| `CHECKOUT_MISMATCH` | 400 | `stores` ≠ stores in the cart |
| `STORE_UNAVAILABLE` | 409 | a store is paused or its business is not approved |
| `DELIVERY_UNAVAILABLE` | 400 | the address city isn't in the store's `deliveryCities` (case/space-insensitive; empty list = nationwide) |
| `PAYMENT_METHOD_UNAVAILABLE` | 400 | COD disabled, or transfer chosen but the store has no active account |
| `COD_LIMIT_EXCEEDED` | 400 | COD and the store order total (shipping included) > `codLimit`; `details: { codLimit, total }` |
| `OUT_OF_STOCK` | 409 | `details.lines: [{ variantId, productName, variantLabel, requested, available }]` (unpublished products count as 0) |
| `COUPON_INVALID` | 400 | unknown, deactivated or not-yet-started code |
| `COUPON_EXPIRED` | 400 | past `endsAt` |
| `COUPON_MIN_ORDER` | 400 | `details: { minOrder, subtotal, shortBy }` |
| `COUPON_LIMIT_REACHED` | 400 / 409 | `details.scope: "coupon"` (used up) or `"customer"` (per-customer limit); 409 when the last use went to someone else mid-checkout |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | header missing |

Pricing: line = `(salePrice ?? basePrice) + priceDelta`; store subtotal → coupon
(`percent`: `floor(subtotal × value / 100)`; capped at `maxDiscount` and at the subtotal)
→ shipping (`0` when `subtotal − discount ≥ freeShippingOver`, else `shippingFlatFee`) →
total. Coupons are per store; one code per store order.

---

## 5. Endpoints

### 5.1 Core (shared with Food and Healthcare)

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/addresses` | | `Address[]`, default first |
| POST | `/addresses` | `{ label: home\|work\|other, fullName, phone, city, area, line1, landmark?, lat?, lng?, isDefault? }` | `201 Address` (first one becomes default; max 20) |
| GET / PATCH / DELETE | `/addresses/:id` | partial body | `Address` / `{ removed: true }` (deleting the default promotes the newest) |
| POST | `/addresses/:id/default` | | `Address` |
| GET | `/notifications` | `?unread=true&page` | list of `{ id, type, title, body, data, readAt, createdAt }` |
| GET | `/notifications/unread-count` | | `{ unread }` |
| POST | `/notifications/:id/read` · `/notifications/read-all` | | the notification · `{ updated }` |

Address `phone` is normalised to `+923XXXXXXXXX`. Orders copy the address, so editing or
deleting it never changes an order. Push: Expo tokens registered via `PUT /users/me/devices`
(Chunk 1) receive every notification below; `data` carries deep-link ids.

### 5.2 Catalogue (public, optional auth)

| Method | Path | Notes |
|---|---|---|
| GET | `/shop/home` | `{ banners, featuredStores: StoreCard[], newArrivals: ProductCard[], trending: ProductCard[], categories }` — one call for the home screen. `trending` = units sold in the last 14 days (cancelled orders excluded), topped up by all-time sales. Banners are active, inside their window, and only point at things a customer can open. |
| GET | `/shop/categories` | `[{ id, name, slug, icon, children: [{ id, name, slug, icon }] }]` — includes *(Chunk 5)* the **Grocery** root (`grocery`) and its aisles (`grocery-vegetables-fruit`, `-meat-poultry`, `-dairy-eggs`, `-rice-flour`, `-pulses`, `-spices`, `-oil-ghee`, `-bakery`, `-sauces`, `-beverages`, `-snacks`). |
| GET | `/shop/stores` | `?q&categoryId&city&featured=true&page&pageSize` → `StoreCard` list. `categoryId` (root matches its subtree) = stores selling there; `city` = stores delivering there. |
| GET | `/shop/stores/:slug` | `StoreCard` + `{ about, socials, collections: [{ id, name, slug, productCount }], policies: { shippingFlatFee, freeShippingOver, returnWindowDays, dispatchDaysMin, dispatchDaysMax, deliveryCities, paymentMethods: ["cod","transfer"], codLimit, transferVia: ["bank","jazzcash"] } }` — **never account numbers**. |
| GET | `/shop/products` | `?q&storeId&categoryId&collectionId&minPrice&maxPrice&inStock=true&minRating&onSale=true&sort&page&pageSize` → `ProductCard` list. `sort`: `relevance` (default; with `q` = text rank, without = popularity) `newest`, `price_asc`, `price_desc`, `rating`, `popular`. Prices filter/sort on the effective price. `categoryId` of a root matches its children. `q` supports words, `"phrases"` and `-exclusions`; when nothing matches, a typo-tolerant name match runs instead ("kurtta" finds "kurta"). |
| GET | `/shop/products/suggest` | `?q` (required) → `{ products: ProductCard[≤5], stores: StoreCard[≤3] }` for search-as-you-type. |
| GET | `/shop/products/:id` | `ProductCard` + `{ description, tags, categoryId, collectionId, images: [{ id, url }], options: { option1: ["S","M"], option2: ["Maroon"] }, variants: [{ id, option1, option2, label, colorHex, price, pack, pricePer, inStock, lowStock }], pack, pricePer, store: { …StoreCard essentials, returnWindowDays, codEnabled, shippingFlatFee, freeShippingOver, dispatchDaysMin, dispatchDaysMax }, ratingBreakdown: { "1": 0, …, "5": 7 }, isWishlisted }` |
| GET | `/shop/products/:id/reviews` | `?rating=1..5&withPhotos=true&page` → `Review` list + `summary: { ratingAvg, ratingCount, breakdown }` |
| GET | `/shop/products/:id/related` | up to 10 `ProductCard`s from the same category, other stores first |

Visible = business approved, store not paused, product `active`. Anything else is `404`.

### 5.3 Customer

**Cart** (one cart across stores; lines 1–20 each; at most 50 lines)

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/shop/cart` | | `CartView` |
| POST | `/shop/cart/items` | `{ variantId, quantity }` | `200 CartView` — same variant merges; capped at stock and 20 (`adjusted`). `404` unpublished product/retired option, `409 STORE_UNAVAILABLE`, `409 OUT_OF_STOCK` (none left). |
| PATCH | `/shop/cart/items/:id` | `{ quantity }` | `CartView` (capped at stock; accepts the current price) |
| DELETE | `/shop/cart/items/:id` · `/shop/cart` | | `CartView` |
| POST | `/shop/cart/preview` | checkout body | `CheckoutPlan` (writes nothing) |
| GET | `/shop/stores/:storeId/coupons/available` | | `{ storeSubtotal, items: [{ code, type, value, minOrder, maxDiscount, endsAt, eligible, shortBy, discount }] }` — usable now by this customer (not used up, per-customer limit not reached), with the saving on their cart. |
| POST | `/shop/checkout` | §4 | `201 OrderGroup` |

**Orders**

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/shop/orders` | `?status=active\|completed\|cancelled&page` | list of `{ id, code, placedAt, grandTotal, storeOrders: [{ id, code, store, status, paymentMethod, paymentStatus, total, itemCount, coverImageUrl }] }` (a group matches when any of its store orders does; `active` = placed…shipped, `completed` = delivered/completed) |
| GET | `/shop/orders/:groupCode` | | `OrderGroup` (code is case-insensitive) |
| GET | `/shop/store-orders/:id` | | `StoreOrder` + `groupCode` |
| POST | `/shop/store-orders/:id/cancel` | `{ reason }` (3–500) | `StoreOrder` — only while `placed` |
| POST | `/shop/store-orders/:id/request-cancel` | `{ reason }` | `StoreOrder` — confirmed/packed; once (`409 CONFLICT` again) |
| POST | `/shop/store-orders/:id/payment-proof` | `{ paymentRef, proofUrl? }` | `StoreOrder` (transfer orders awaiting payment; `proofUrl` from a `payment_proof` upload) |
| POST | `/shop/store-orders/:id/received` | | `StoreOrder` (shipped → delivered) |

**Returns, reviews, wishlist, reports**

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/shop/store-orders/:id/returns` | `{ items: [{ orderItemId, quantity }], reason, details?, photos?: string[≤5] }` | `201 ReturnRequest`. `400 RETURN_WINDOW_CLOSED` (`details: { deliveredAt, returnWindowDays, closedAt }`), `409 RETURN_ALREADY_OPEN`, `409 INVALID_TRANSITION` (not delivered yet), `400` quantity above what's still returnable. |
| GET | `/shop/returns` · `/shop/returns/:id` | `?status&page` | `ReturnRequest` list / one |
| POST | `/shop/order-items/:id/review` | `{ rating: 1..5, text?, photos?: string[≤5] }` | `201 Review`. `403 REVIEW_NOT_ALLOWED` before delivery, `409 REVIEW_EXISTS` second time. |
| GET | `/shop/wishlist` | `?page` | `ProductCard` list (+ `available`, `savedAt`), newest first; products that became unavailable stay with `available: false` |
| POST / DELETE | `/shop/wishlist/:productId` | | `{ productId, isWishlisted }` (both idempotent; POST needs a visible product) |
| POST | `/shop/products/:id/report` | `{ reason: counterfeit\|prohibited_item\|misleading\|offensive\|wrong_category\|other, details? }` | `201 { id, status, reason, createdAt }`; `409 CONFLICT` while your previous report on it is open |

### 5.4 Store partner (`/shop/partner`)

**Store**

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/dashboard` | | `{ todayNewOrders, newOrders, toShip, awaitingPaymentConfirmation, refundsDue, cancelRequests, lowStockVariants, openReturns, unrepliedReviews, rating: { avg, count }, recordedSales: { last7Days, last30Days } }` |
| GET | `/insights` | `?range=7d\|30d\|90d` (default 30d) | `{ range, days, ordersPerDay: [{ date, orders }], recordedSalesPerDay: [{ date, amount }], totals: { orders, recordedSales }, topProducts: [{ productId, name, units, value }], repeatCustomers: { customers, repeat, share }, conversion: { placed, delivered, cancelled, rate } }` |
| GET / PATCH | `/store` | `{ tagline?, about?, logoUrl?, coverUrl?, brandColor?, socials? }` | profile; `brandColor` that fails AA contrast with both white and ink → `400 VALIDATION_FAILED` |
| GET / PATCH | `/store/settings` | `{ returnWindowDays 0–30, codEnabled, codLimit, shippingFlatFee, freeShippingOver?, deliveryCities[], dispatchDaysMin, dispatchDaysMax, isPaused, pauseMessage? }` | settings |
| GET / POST | `/store/payment-accounts` | `{ kind: raast\|jazzcash\|easypaisa\|bank, accountTitle, accountNumber, bankName? }` | list / `201` account. Bank = PK IBAN (24 chars, checksum) + `bankName`; others = PK mobile. Max 4 active. |
| PATCH / DELETE | `/store/payment-accounts/:id` | `{ kind?, accountTitle?, accountNumber?, bankName?, isActive? }` | account · `{ removed: true }` (placed orders keep their snapshot) |
| GET / POST | `/collections` | `{ name }` | |
| PATCH | `/collections/reorder` | `{ ids: [...] }` | |
| PATCH / DELETE | `/collections/:id` | `{ name }` | |

**Products and inventory**

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/products` | `?status&q&collectionId&lowStock=true&page` | list of `{ id, name, slug, status, basePrice, salePrice, price, categoryId, collectionId, coverUrl, variantCount, totalStock, lowStock, soldCount, ratingAvg, updatedAt }` |
| POST | `/products` | `{ name, description, categoryId, collectionId?, basePrice, salePrice?, tags?, images?: [{ url, publicId }] (≤8, first = cover), variants?: [{ option1?, option2?, colorHex?, sku?, priceDelta?, stock?, isActive?, packQty?, packUnit? }] (1–100; omit = one default variant), status?: draft\|active, packQty?, packUnit? }` | `201 PartnerProduct`. `salePrice ≥ basePrice` → 400; publishing needs ≥ 1 image and ≥ 1 active variant; option combinations unique; every variant price > 0. |
| GET / PATCH | `/products/:id` | PATCH: any create field + `status: draft\|active\|archived`; `variants` is the full desired set (with `id` = update, without = add or revive by options, missing = deactivated) | `PartnerProduct` (exact stock per variant). A `removed` product can't change status (`409 INVALID_TRANSITION`). |
| DELETE | `/products/:id` | | `{ archived, deleted }` — archived if it was ever ordered, otherwise deleted |
| POST | `/products/:id/duplicate` | | `201 PartnerProduct` (draft copy, stock 0) |
| GET | `/inventory` | `?lowStock=true&q&page` | `[{ variantId, productId, productName, label, sku, stock, isActive, lowStock }]`, lowest stock first |
| PATCH | `/inventory/:variantId` | `{ delta }` **or** `{ setTo }` | `{ variantId, stock }`; can't go below 0 |
| POST | `/inventory/bulk` | `[{ variantId, setTo }]` (1–200, top-level array) | `{ updated, items: [{ variantId, stock }] }` — all or nothing; any foreign variant → 404 |
| GET | `/inventory/:variantId/movements` | `?page` | `[{ id, delta, reason: order\|cancel\|return_restock\|manual\|bulk, refType, refId, actorUserId, balanceAfter, createdAt }]` newest first |

**Orders, coupons, returns, reviews**

| Method | Path | Body |
|---|---|---|
| GET | `/orders` | `?status&paymentStatus&q (code, customer name or phone)&page` → `[{ id, code, status, paymentMethod, paymentStatus, total, itemCount, customerName, city, payBy, cancelRequested, placedAt }]` |
| GET | `/orders/:id` | `PartnerStoreOrder` |
| POST | `/orders/:id/confirm` · `/pack` · `/deliver` | — |
| POST | `/orders/:id/reject` · `/cancel` | `{ reason }` |
| POST | `/orders/:id/ship` | `{ courierName, trackingRef }` or `{ courierName: "self", riderName, riderPhone }` |
| POST | `/orders/:id/payment/confirm` | — |
| POST | `/orders/:id/payment/reject` | `{ reason }` |
| POST | `/orders/:id/cash-collected` | — |
| POST | `/orders/:id/refund` | `{ amount, refundRef }` |
| GET / POST | `/coupons` | `?state&page` · `{ code (3–20, A–Z 0–9 -), type: percent\|fixed, value, minOrder?, maxDiscount?, startsAt?, endsAt, usageLimit?, perUserLimit? (default 1) }` → `Coupon`; duplicate code `409 CONFLICT` |
| GET / PATCH | `/coupons/:id` | any field but `code` (+ `isActive`); `type`/`value` locked once used (`409 CONFLICT`); `usageLimit` ≥ `usedCount` |
| POST | `/coupons/:id/deactivate` | — |
| GET | `/returns` · `/returns/:id` | `?status&page` |
| POST | `/returns/:id/approve` · `/reject` · `/receive` · `/refund` | see §3 |
| GET | `/reviews` | `?rating&unreplied=true&page` |
| POST | `/reviews/:id/reply` | `{ text }` — once; editable for 24 h (`409 CONFLICT` after) |

All order actions return `PartnerStoreOrder`.

### 5.5 Admin (`/admin/shop`, roles `admin`/`super_admin`; every write audited)

| Method | Path | Body / notes |
|---|---|---|
| GET / POST | `/categories` | tree incl. inactive · `{ name, slug?, parentId?, icon?, sort? }` (two levels; slug unique → 409) |
| PATCH / DELETE | `/categories/:id` | `+ isActive` · delete only an unused leaf (`409 CONFLICT` with `{ children, products }` → deactivate instead) |
| GET / POST | `/banners` | `{ imageUrl (admin banner upload), title, subtitle?, targetType: store\|category\|collection\|product\|none, targetId?, startsAt?, endsAt?, sort?, isActive? }` |
| PATCH / DELETE | `/banners/:id` | |
| POST | `/stores/:id/feature` · `/unfeature` | |
| GET | `/reports` | `?status=open\|dismissed\|actioned` (default open), oldest first, with product + store |
| POST | `/reports/:id/dismiss` | `{ note? }` |
| POST | `/products/:id/remove` | `{ reason }` — status `removed` (hidden from catalogue, search and suggest), its open reports `actioned`, store notified; existing orders untouched |
| POST | `/products/:id/restore` | back to `active` (or `draft` without a photo/active variant) |
| GET | `/orders` · `/orders/:id` | `?code&storeId&status&page` — read-only dispute lookup |
| POST | `/reviews/:id/hide` · `/unhide` | `{ reason }` for hide; ratings recomputed |

---

### 5.6 Pack size and price per unit (Chunk 5, My Kitchen)

- Grocery products carry a **pack size**: `packQty` with `packUnit` (`g`, `kg`, `ml`, `l`, `piece`,
  `dozen`) on the product, and optionally on a variant, which overrides it (a 5 kg bag next to a
  1 kg one). Both are given or neither (`400 VALIDATION_FAILED` on `pack`).
- Product and variant views add `pack: { qty, unit } | null` and
  `pricePer: { price, per: kg|l|piece } | null` — the effective price ÷ the pack in kg, l or
  pieces (`shopping/common/pack.ts`).
- My Kitchen's missing-to-bag compare (`POST /my-kitchen/missing-to-bag`, `docs/API_KITCHEN.md`
  §34) sorts grocery products by it.

## 6. Error codes added in Chunk 2

| Code | HTTP | Meaning |
|---|---|---|
| `WRONG_SERVICE` | 403 | partner of another service on a shopping route |
| `STORE_UNAVAILABLE` | 409 | store paused / not approved |
| `DELIVERY_UNAVAILABLE` | 400 | store doesn't deliver to the address city |
| `CART_EMPTY` | 400 | checkout with an empty cart |
| `CHECKOUT_MISMATCH` | 400 | checkout stores ≠ cart stores |
| `OUT_OF_STOCK` | 409 | not enough stock (`details.lines`) |
| `PRICE_CHANGED` | — | warning code in cart/preview (never an error: checkout charges the live price) |
| `COUPON_INVALID` · `COUPON_EXPIRED` · `COUPON_MIN_ORDER` · `COUPON_LIMIT_REACHED` | 400 (409 race) | coupon problems |
| `COD_LIMIT_EXCEEDED` | 400 | COD total above the store's limit |
| `PAYMENT_METHOD_UNAVAILABLE` | 400 | COD off / no transfer account |
| `PAYMENT_NOT_CONFIRMED` | 409 | shipping a transfer order before it's paid |
| `INVALID_TRANSITION` | 409 | illegal state move (`{ from, to, allowed }`) |
| `RETURN_WINDOW_CLOSED` | 400 | outside the return window |
| `RETURN_ALREADY_OPEN` | 409 | a return is already in progress |
| `REVIEW_NOT_ALLOWED` | 403 | line not delivered yet |
| `REVIEW_EXISTS` | 409 | line already reviewed |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | checkout without the header |

Plus the Chunk 1 codes (`VALIDATION_FAILED`, `NOT_FOUND`, `CONFLICT`, `FORBIDDEN`, …).

---

## 7. Notifications (`type` → `data`)

| Type | To | `data` |
|---|---|---|
| `shop.order.new` | store | `{ storeOrderId, code }` |
| `shop.order.placed` | customer | `{ groupCode }` |
| `shop.order.confirmed` · `.rejected` · `.shipped` · `.delivered` · `.cancelled` | customer (cancelled: both) | `{ storeOrderId, code }` |
| `shop.order.cancel_requested` · `shop.order.reminder` | store | `{ storeOrderId, code }` |
| `shop.order.stale` | customer (48 h unconfirmed) | `{ storeOrderId, code }` |
| `shop.payment.proof` | store | `{ storeOrderId, code }` |
| `shop.payment.confirmed` · `.rejected` · `.refunded` | customer | `{ storeOrderId, code }` |
| `shop.return.requested` | store | `{ storeOrderId, code }` |
| `shop.return.approved` · `.rejected` · `.refunded` | customer | `{ returnId, storeOrderId, code }` |
| `shop.review.new` | store | `{ reviewId, productId }` |
| `shop.inventory.low_stock` | store | `{ screen: "inventory", lowStock: true }` |
| `shop.product.removed` | store | `{ productId }` |

## 8. Scheduled jobs

Each runs under a Postgres advisory lock (safe with several dynos), changes rows only
through conditional updates, notifies after commit, and logs its counts. `JOBS_ENABLED=false`
turns the schedule off (tests call the jobs directly).

| Schedule | Job |
|---|---|
| every 10 min | transfer orders still `awaiting_transfer` past `payBy` → cancelled by `system`, restocked, both sides notified |
| hourly (:05) | `placed` > 12 h → remind the store (once); > 48 h → tell the customer they may cancel (once) |
| daily 03:00 PKT | `delivered` past the order's return window with no open return → `completed` |
| daily 09:00 PKT | low-stock digest to each store with active variants at ≤ 3 (once per day) |

## 9. Decisions this contract makes (not in the brief)

- Catalogue routes use **optional auth**; a bad token is anonymous, not 401.
- Search: a trigger-maintained `tsvector` (name A, tags B, description C) + `websearch_to_tsquery`;
  when that finds nothing, `word_similarity(q, name) ≥ 0.55` (pg_trgm) catches typos.
- A **root category matches its subtree** in every filter.
- Variant options are unique per product including "no options" (`NULLS NOT DISTINCT`);
  variants are never deleted, only deactivated; their display order is the partner's order.
- The cart stores `priceAtAdd` to detect price changes; checkout always charges the live price.
- **Free shipping** is judged on `subtotal − discount`. The **COD limit** applies to the store
  order total including shipping. Delivery cities match case- and space-insensitively.
- A rejected transfer proof sets `payBy = max(payBy, now + 12 h)` so the customer can resubmit
  before the deadline job runs. Cancelling while proof is submitted (unconfirmed) → `refund_due`.
- Return refunds are recorded on the return, capped at the returned lines' value; the store
  order's payment status is unchanged. Cancel-after-payment uses `refund_due → refunded`.
- The return window is **snapshotted** on the order at checkout (changing the store setting
  later doesn't affect placed orders).
- Codes: `MM-` + 6 characters from an alphabet without 0/O/1/I/L; store orders `-1`, `-2`, ….
- Stores are created when a shopping business is approved (inside the approval
  transaction), lazily on first partner use, and by `npm run backfill:stores`.
- Deleting a customer account deletes their cart, wishlist and addresses; orders keep their
  snapshots.
- Admin restore returns a product to `active`, or `draft` if it no longer has a photo and an
  active variant.
- `GET /shop/home.trending` is units sold in 14 days; demo data's `soldCount` is synthetic.

## 10. Demo data

`npm run seed:shopping` (needs `SEED_DEMO_PASSWORD`) creates four approved stores —
Lahore Loom (fashion), Glow Theory (beauty), Ghar Ghar Home (home), Haath Kaari
(handmade) — signed in as `demo.<fashion|beauty|home|handmade>@metromatrix.test`, each with
18 products, collections, two coupons and payment accounts, plus three home banners.
Images are generated tiles (see `seed/assets/shopping/README.md`).
