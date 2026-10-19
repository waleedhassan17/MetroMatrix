#!/usr/bin/env node
/**
 * Generates postman/MetroMatrix-Kitchen.postman_collection.json (Chunk 5).
 *
 *   node scripts/gen-kitchen-postman.mjs
 *
 * Run it against a server with seed:food + seed:kitchen and AI_ENABLED=false
 * (deterministic: typed voice is read by the rule parser, AI routes take their
 * manual path): `npm run postman:kitchen`. The sign-in, Mailpit and admin TOTP
 * steps are copied from the Food collection so both stay in step.
 */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const food = JSON.parse(readFileSync(join(root, 'postman/MetroMatrix-Food.postman_collection.json'), 'utf8'));
const fromFood = (name) => {
  const it = food.item[0].item.find((i) => i.name === name);
  if (!it) throw new Error(`Food collection has no "${name}"`);
  return JSON.parse(JSON.stringify(it));
};

const bearer = (v) => ({ type: 'bearer', bearer: [{ key: 'token', value: `{{${v}}}`, type: 'string' }] });

/** One request: tests always check the status, then `tests` lines run with `d` = data. */
function req(name, method, path, o = {}) {
  const status = o.status ?? (method === 'POST' && !o.ok200 ? 201 : 200);
  const exec = [`pm.test('${name.replace(/'/g, "\\'")} → ${status}', () => pm.response.to.have.status(${status}));`, '', 'const body = pm.response.json();', 'const d = body.data;', ...(o.tests ?? [])];
  const item = {
    name,
    request: {
      method,
      header: o.headers ?? [],
      url: `{{baseUrl}}${path}`,
      auth: o.as ? bearer(o.as) : { type: 'noauth' },
      ...(o.body !== undefined
        ? { body: { mode: 'raw', raw: typeof o.body === 'string' ? o.body : JSON.stringify(o.body, null, 2), options: { raw: { language: 'json' } } } }
        : {}),
    },
    event: [
      ...(o.pre ? [{ listen: 'prerequest', script: { type: 'text/javascript', exec: o.pre } }] : []),
      { listen: 'test', script: { type: 'text/javascript', exec } },
    ],
  };
  return item;
}
const set = (k, expr) => `pm.collectionVariables.set('${k}', ${expr});`;
const folder = (name, items) => ({ name, item: items });

// ── 0 · Setup ──
const vendorSignIn = req('Vendor (Zafran Biryani Kitchen): sign in', 'POST', '/auth/signin', {
  ok200: true,
  body: { email: 'demo.food.zafran@metromatrix.test', password: '{{demoPassword}}', portal: 'partner' },
  tests: [set('vendorToken', 'd.tokens.accessToken'), "pm.test('a live food vendor', () => pm.expect(d.business.food.isLive).to.be.true);"],
});
const signUp = fromFood('Customer: sign up');
signUp.event[0].script.exec = ["const run = Date.now().toString(36);", "pm.collectionVariables.set('runId', run);", "pm.collectionVariables.set('customerEmail', 'pm.kitchen.' + run + '@example.com');"];
const address = fromFood('Customer: an address with a map pin (Clifton)');
address.name = 'Customer: an address with a map pin (Model Town, Lahore)';
address.request.body.raw = JSON.stringify(
  { label: 'home', fullName: 'Postman Kitchen Foodie', phone: '0333 2190199', city: 'Lahore', area: 'Model Town', line1: 'House 12, Block C', lat: 31.4834, lng: 74.3256, isDefault: true },
  null,
  2,
);
address.event = address.event.map((e) => {
  if (e.listen !== 'test') return e;
  return { ...e, script: { ...e.script, exec: e.script.exec.map((l) => l.replace(/ \(Clifton\)/g, ' (Model Town, Lahore)')) } };
});

const setup = folder('0 · Setup (needs seed:food + seed:kitchen, AI_ENABLED=false)', [
  fromFood('Health'),
  fromFood('Admin: sign in (step 1)'),
  fromFood('Admin: enrol TOTP (first time)'),
  fromFood('Admin: confirm TOTP (first time)'),
  fromFood('Admin: sign in (step 2, TOTP)'),
  vendorSignIn,
  signUp,
  fromFood('Mailpit: verification code'),
  fromFood('Customer: verify email'),
  address,
  req('AI: usage and switches (vendor)', 'GET', '/ai/usage', {
    as: 'vendorToken',
    tests: [
      "pm.test('300 smart actions, 120 voice minutes a month', () => { pm.expect(d.aiActions.limit).to.eql(300); pm.expect(d.voiceMinutes.limit).to.eql(120); });",
      "pm.test('AI is off for this run (deterministic)', () => pm.expect(d.enabled, 'start the server with AI_ENABLED=false').to.be.false);",
      "pm.test('the vendor voice screens', () => pm.expect(d.voiceContexts).to.include.members(['board', 'today', 'stock', 'purchase', 'menu_search']));",
    ],
  }),
]);

// ── 1 · Stock ──
const stock = folder('1 · Ingredients and stock', [
  req('Kitchen setup: dishes without a recipe card', 'GET', '/food/vendor/kitchen/setup', {
    as: 'vendorToken',
    tests: ["pm.test('the seed gave every dish a card', () => pm.expect(d.itemsWithRecipe).to.be.above(0));"],
  }),
  req('Stock: summary, negative and expiring first', 'GET', '/food/vendor/kitchen/stock?pageSize=50', {
    as: 'vendorToken',
    tests: [
      "pm.test('a list with a summary', () => { pm.expect(d.items).to.be.an('array'); pm.expect(d.summary.ingredients).to.be.above(10); });",
      "const rice = d.items.find((i) => i.name === 'Basmati Rice');",
      "pm.test('rice in kg, with an average price', () => { pm.expect(rice.baseUnit).to.eql('g'); pm.expect(rice.avgPrice.per).to.eql('kg'); });",
      set('riceId', 'rice.id'),
    ],
  }),
  req('Ingredient: create (eggs, counted in trays)', 'POST', '/food/vendor/kitchen/ingredients', {
    as: 'vendorToken',
    body: {
      name: 'Postman Eggs {{runId}}',
      nameUr: 'انڈے',
      category: 'dairy',
      baseUnit: 'piece',
      customUnits: [{ name: 'tray', factor: 30 }],
      parLevel: { qty: 1, unit: 'tray' },
      openingStock: { qty: 2, unit: 'tray', totalCost: 1680 },
    },
    tests: [
      "pm.test('60 pieces at Rs 28', () => { pm.expect(d.onHand).to.eql(60); pm.expect(d.avgCost).to.eql(28); });",
      "pm.test('units include the tray', () => pm.expect(d.units).to.include('tray'));",
      set('eggsId', 'd.id'),
    ],
  }),
  req('Ingredient: a unit of the wrong kind → UNIT_MISMATCH', 'POST', '/food/vendor/kitchen/ingredients', {
    as: 'vendorToken',
    status: 400,
    body: { name: 'Postman Milk {{runId}}', category: 'dairy', baseUnit: 'ml', parLevel: { qty: 2, unit: 'kg' } },
    tests: ["pm.test('UNIT_MISMATCH with the allowed units', () => { pm.expect(body.error.code).to.eql('UNIT_MISMATCH'); pm.expect(body.error.details.allowed).to.eql(['ml', 'l']); });"],
  }),
  req('Stock take: count the eggs', 'POST', '/food/vendor/kitchen/stock/count', {
    as: 'vendorToken',
    ok200: true,
    body: { lines: [{ ingredientId: '{{eggsId}}', qty: 4, unit: 'dozen' }], note: 'Postman count' },
    tests: ["pm.test('60 → 48', () => pm.expect(d.adjusted[0]).to.include({ before: 60, counted: 48, delta: -12 }));"],
  }),
  req('Movements: the ledger', 'GET', '/food/vendor/kitchen/stock/{{eggsId}}/movements', {
    as: 'vendorToken',
    tests: ["pm.test('opening stock, then the count', () => pm.expect(d.items.map((m) => m.reason)).to.eql(['count_adjust', 'manual']));"],
  }),
  req('Batches: what FIFO uses next', 'GET', '/food/vendor/kitchen/stock/{{riceId}}/batches', {
    as: 'vendorToken',
    tests: ["pm.test('oldest first', () => pm.expect(d.length).to.be.above(0));"],
  }),
]);

// ── 2 · Recipes ──
const recipes = folder('2 · Recipe cards and sold-out', [
  req('Menu: the categories', 'GET', '/food/vendor/menu/categories', { as: 'vendorToken', tests: [set('categoryId', 'd[0].id')] }),
  req('Dish: create one for this run', 'POST', '/food/vendor/menu/items', {
    as: 'vendorToken',
    body: { categoryId: '{{categoryId}}', name: 'Postman Anda Shami {{runId}}', basePrice: 450 },
    tests: [set('dishId', 'd.id')],
  }),
  req('Recipe card: 2 eggs a plate', 'PUT', '/food/vendor/kitchen/items/{{dishId}}/recipe', {
    as: 'vendorToken',
    body: { yieldServings: 1, lines: [{ ingredientId: '{{eggsId}}', qty: 2, unit: 'piece' }] },
    tests: ["pm.test('24 plates from 48 eggs', () => pm.expect(d.servings).to.eql(24));", "pm.test('cost per plate Rs 56', () => pm.expect(d.costPerServing).to.eql(56));"],
  }),
  req('Servings: what runs out first', 'GET', '/food/vendor/kitchen/items/{{dishId}}/servings', {
    as: 'vendorToken',
    tests: ["pm.test('limited by the eggs', () => pm.expect(d.cards[0].limitedBy.ingredientId).to.eql(pm.collectionVariables.get('eggsId')));"],
  }),
  req('Stock take: no eggs left → the dish is sold out by stock', 'POST', '/food/vendor/kitchen/stock/count', {
    as: 'vendorToken',
    ok200: true,
    body: { lines: [{ ingredientId: '{{eggsId}}', qty: 0, unit: 'piece' }] },
  }),
  req('Insight cards: sold out by stock', 'GET', '/food/vendor/kitchen/insights/cards', {
    as: 'vendorToken',
    tests: [
      "const c = d.find((x) => x.kind === 'sold_out_by_stock' && x.data.itemId === pm.collectionVariables.get('dishId'));",
      "pm.test('a card that opens the purchase screen', () => pm.expect(c.action.screen).to.eql('kitchen.purchase.new'));",
    ],
  }),
]);

// ── 3 · Purchases, costing, waste ──
const money = folder('3 · Purchases, costing, price watch, waste', [
  req('Supplier: add', 'POST', '/food/vendor/kitchen/suppliers', {
    as: 'vendorToken',
    body: { name: 'Postman Poultry {{runId}}', phone: '03001234567' },
    tests: [set('supplierId', 'd.id')],
  }),
  req('Purchase: 3 trays of eggs → stock back, dish back on the menu', 'POST', '/food/vendor/kitchen/purchases', {
    as: 'vendorToken',
    body: { supplierId: '{{supplierId}}', lines: [{ ingredientId: '{{eggsId}}', qty: 3, unit: 'tray', totalPrice: 2700 }] },
    tests: ["pm.test('90 eggs at Rs 30', () => pm.expect(d.lines[0]).to.include({ qtyBase: 90, unitCost: 30, totalPrice: 2700 }));", set('purchaseId', 'd.id')],
  }),
  req('Ingredient: the new average cost', 'GET', '/food/vendor/kitchen/ingredients/{{eggsId}}', {
    as: 'vendorToken',
    tests: ["pm.test('weighted average: all 90 bought at Rs 30', () => { pm.expect(d.onHand).to.eql(90); pm.expect(d.avgCost).to.eql(30); });"],
  }),
  req('Costing: every dish and size', 'GET', '/food/vendor/kitchen/costing', {
    as: 'vendorToken',
    tests: [
      "const row = d.items.find((r) => r.itemId === pm.collectionVariables.get('dishId'));",
      "pm.test('Rs 60 for a Rs 450 plate: 13.3%', () => pm.expect(row).to.include({ cost: 60, foodCostPct: 13.3, margin: 390, aboveTarget: false }));",
    ],
  }),
  req('Price watch: your price against the PBS city price', 'GET', '/food/vendor/kitchen/price-watch', {
    as: 'vendorToken',
    tests: [
      "pm.test('Lahore', () => pm.expect(d.city).to.eql('Lahore'));",
      "const t = d.items.find((i) => i.name === 'Tomato');",
      "pm.test('tomatoes flagged (seeded prices ran up)', () => pm.expect(t.aboveReference || t.referenceRising).to.be.true);",
    ],
  }),
  req('Settings: food cost target', 'PATCH', '/food/vendor/kitchen/settings', {
    as: 'vendorToken',
    body: { targetFoodCostPct: 35 },
    tests: ["pm.test('35%', () => pm.expect(d.targetFoodCostPct).to.eql(35));"],
  }),
  req('Waste: 6 eggs broken', 'POST', '/food/vendor/kitchen/waste', {
    as: 'vendorToken',
    body: { ingredientId: '{{eggsId}}', qty: 6, unit: 'piece', reason: 'spoiled', note: 'Dropped a tray' },
    tests: ["pm.test('costed at Rs 30 each', () => pm.expect(d.cost).to.eql(180));"],
  }),
  req('Waste: summary (7 days)', 'GET', '/food/vendor/kitchen/waste/summary?range=7d', {
    as: 'vendorToken',
    tests: ["pm.test('totals by reason', () => { pm.expect(d.totalCost).to.be.above(0); pm.expect(d.byReason.length).to.be.above(0); });"],
  }),
  req('Receipt scan with AI off → AI_UNAVAILABLE and the manual path', 'POST', '/food/vendor/kitchen/purchases/scan', {
    as: 'vendorToken',
    status: 503,
    body: { imageUrl: 'https://res.cloudinary.com/x/image/authenticated/s--Ab12_cd-9--/v1/metromatrix/x/u/receipt/r.jpg' },
    tests: ["pm.test('AI_UNAVAILABLE, or a refused URL', () => pm.expect(['AI_UNAVAILABLE', 'VALIDATION_FAILED']).to.include(body.error.code));"],
    pre: [],
  }),
  req('Purchase: delete — refused once some of it is used', 'DELETE', '/food/vendor/kitchen/purchases/{{purchaseId}}', {
    as: 'vendorToken',
    status: 409,
    tests: ["pm.test('CONFLICT', () => pm.expect(body.error.code).to.eql('CONFLICT'));"],
  }),
]);
// The receipt URL above isn't the vendor's own upload: with AI off the check order makes it a 400 or 503.
money.item.find((i) => i.name.startsWith('Receipt scan')).event[1].script.exec[0] =
  "pm.test('Receipt scan with AI off → refused', () => pm.expect([400, 503]).to.include(pm.response.code));";

// ── 4 · Forecast and prep ──
const forecast = folder('4 · Forecast, prep sheet, shopping list, smart ETA', [
  req('Forecast: the next 7 days', 'GET', '/food/vendor/kitchen/forecast?days=7', {
    as: 'vendorToken',
    tests: [
      "pm.test('60 days of history: weighted forecasts', () => pm.expect(d.learning).to.be.false);",
      "const tomorrow = d.items.find((r) => r.date !== d.from && r.method === 'weighted');",
      set('forecastId', 'tomorrow.id'),
      set('forecastDate', 'tomorrow.date'),
    ],
  }),
  req('Forecast: your own number for tomorrow', 'PATCH', '/food/vendor/kitchen/forecast/{{forecastId}}', {
    as: 'vendorToken',
    body: { adjusted: 40 },
    tests: ["pm.test('kept', () => pm.expect(d.adjusted).to.eql(40));"],
  }),
  req('Prep sheet: planned portions × recipe cards', 'GET', '/food/vendor/kitchen/prep-sheet?date={{forecastDate}}', {
    as: 'vendorToken',
    tests: ["pm.test('ingredients grouped by category', () => pm.expect(d.ingredients.length).to.be.above(0));"],
  }),
  req('Shopping list: need − stock + 10%', 'GET', '/food/vendor/kitchen/shopping-list?date={{forecastDate}}', {
    as: 'vendorToken',
    tests: [
      "pm.test('a 10% buffer', () => pm.expect(d.bufferPct).to.eql(10));",
      "pm.test('shareable text', () => pm.expect(d.whatsappUrl).to.match(/^https:\\/\\/wa\\.me\\//));",
    ],
  }),
  req('Smart ETA: what the kitchen has learned', 'GET', '/food/vendor/kitchen/eta-accuracy', {
    as: 'vendorToken',
    tests: ["pm.test('learned buckets with ≥ 20 samples', () => pm.expect(d.learned.some((b) => b.inUse)).to.be.true);"],
  }),
  req('Outage pause: gas, 30 minutes', 'POST', '/food/vendor/pause', {
    as: 'vendorToken',
    ok200: true,
    body: { reason: 'gas', minutes: 30 },
    tests: ["pm.test('back around …', () => pm.expect(d.branch.pauseMessage).to.match(/^Temporarily paused · back around/));"],
  }),
  req('Vendor page (guest): the time, never the reason', 'GET', '/food/vendors/zafran-biryani-kitchen', {
    tests: ["pm.test('no reason shown', () => pm.expect(pm.response.text()).to.not.match(/\\bgas\\b/i));"],
  }),
  req('Resume', 'POST', '/food/vendor/resume', { as: 'vendorToken', ok200: true }),
]);

// ── 5 · Orders, stock and voice ──
const orders = folder('5 · An order takes stock; voice; the announcement', [
  req('Customer: add the dish', 'POST', '/food/cart/items', {
    as: 'customerToken',
    pre: ["pm.collectionVariables.set('checkoutKey', 'pm-kitchen-' + Date.now());"],
    body: { vendorId: '{{vendorBrandId}}', itemId: '{{dishId}}', quantity: 2 },
  }),
  req('Customer: checkout (COD)', 'POST', '/food/checkout', {
    as: 'customerToken',
    headers: [{ key: 'Idempotency-Key', value: '{{checkoutKey}}' }],
    body: { paymentMethod: 'cod', addressId: '{{addressId}}' },
    tests: [set('orderId', 'd.id'), set('orderCode', 'd.code')],
  }),
  req('Voice (typed): "order accept karo, bees minute" → a proposed accept', 'POST', '/ai/voice', {
    as: 'vendorToken',
    ok200: true,
    body: { context: 'board', text: '{{orderCode}} accept karo, bees minute' },
    tests: [
      "pm.test('nothing executed: a proposal', () => { pm.expect(d.needsConfirmation).to.be.true; pm.expect(d.intent).to.eql('accept'); });",
      "pm.test('the accept request for this order, 20 minutes', () => { pm.expect(d.proposedAction.path).to.eql('/food/vendor/orders/' + pm.collectionVariables.get('orderId') + '/accept'); pm.expect(d.proposedAction.body).to.eql({ etaMinutes: 20 }); });",
    ],
  }),
  req('Announcement (Urdu): the new order read aloud', 'GET', '/ai/announce?orderId={{orderId}}', {
    as: 'vendorToken',
    tests: ["pm.test('Urdu text, no TTS', () => { pm.expect(d.text).to.match(/^نیا آرڈر:/); pm.expect(d.ttsUrl).to.be.null; });"],
  }),
  req('Vendor: accept (the confirmed proposal)', 'POST', '/food/vendor/orders/{{orderId}}/accept', {
    as: 'vendorToken',
    ok200: true,
    body: { etaMinutes: 20 },
  }),
  req('Movements: the order took 4 eggs', 'GET', '/food/vendor/kitchen/stock/{{eggsId}}/movements', {
    as: 'vendorToken',
    tests: ["pm.test('an order movement with the code', () => pm.expect(d.items[0]).to.include({ reason: 'order', delta: -4, orderCode: pm.collectionVariables.get('orderCode') }));"],
  }),
  req('Voice (typed, stock screen): a count', 'POST', '/ai/voice', {
    as: 'vendorToken',
    ok200: true,
    body: { context: 'stock', text: 'chawal bees kilo baqi hain' },
    tests: ["pm.test('a proposed stock count for the rice', () => { pm.expect(d.intent).to.eql('count'); pm.expect(d.proposedAction.path).to.eql('/food/vendor/kitchen/stock/count'); pm.expect(d.proposedAction.body.lines[0]).to.include({ ingredientId: pm.collectionVariables.get('riceId'), qty: 20, unit: 'kg' }); });"],
  }),
  req('Voice (typed, purchase screen): "5 kilo tamatar 1200 rupay"', 'POST', '/ai/voice', {
    as: 'vendorToken',
    ok200: true,
    body: { context: 'purchase', text: '5 kilo tamatar 1200 rupay' },
    tests: ["pm.test('a draft line: tomato 5000 g, Rs 1,200', () => pm.expect(d.draft.lines[0]).to.include({ name: 'Tomato', qtyBase: 5000, totalPrice: 1200 }));"],
  }),
  req('Voice: chatter → VOICE_UNCLEAR with a hint', 'POST', '/ai/voice', {
    as: 'vendorToken',
    status: 422,
    body: { context: 'board', text: 'aaj mausam bohat acha hai' },
    tests: ["pm.test('VOICE_UNCLEAR', () => { pm.expect(body.error.code).to.eql('VOICE_UNCLEAR'); pm.expect(body.error.details.hint).to.match(/^Try/); });"],
  }),
]);
// The vendor's brand id, for the cart.
vendorSignIn.event[0].script.exec.push(set('vendorBrandId', 'd.business.food.brandId'));

// ── 6 · Bachat Box ──
const surplus = folder('6 · Bachat Box and donations', [
  req('Vendor: tonight’s box', 'POST', '/food/vendor/kitchen/surplus-boxes', {
    as: 'vendorToken',
    pre: [
      "const now = new Date();",
      "const endOfDayPk = new Date(Math.floor((now.getTime() + 5 * 3600e3) / 86400e3) * 86400e3 + 86400e3 - 5 * 3600e3 - 60e3);",
      "const to = new Date(Math.min(now.getTime() + 60 * 60e3, endOfDayPk.getTime()));",
      "pm.collectionVariables.set('pickupFrom', now.toISOString());",
      "pm.collectionVariables.set('pickupTo', to.toISOString());",
    ],
    body: '{\n  "title": "Postman Bachat Box",\n  "contentsHint": "Usually biryani and raita",\n  "originalValue": 1100,\n  "price": 450,\n  "quantity": 2,\n  "pickupFrom": "{{pickupFrom}}",\n  "pickupTo": "{{pickupTo}}"\n}',
    tests: ["pm.test('59% off, live', () => pm.expect(d).to.include({ discountPct: 59, status: 'live', remaining: 2 }));", set('boxId', 'd.id')],
  }),
  req('Guest: boxes nearby', 'GET', '/food/surplus?lat=31.4834&lng=74.3256', {
    tests: ["pm.test('our box is there', () => pm.expect(d.map((b) => b.id)).to.include(pm.collectionVariables.get('boxId')));"],
  }),
  req('Customer: reserve one', 'POST', '/food/surplus/{{boxId}}/reserve', {
    as: 'customerToken',
    pre: ["pm.collectionVariables.set('reserveKey', 'pm-bb-' + Date.now());"],
    headers: [{ key: 'Idempotency-Key', value: '{{reserveKey}}' }],
    body: { quantity: 1, paymentMethod: 'pay_at_pickup' },
    tests: ["pm.test('a BB- code', () => pm.expect(d.code).to.match(/^BB-[A-Z2-9]{6}$/));", set('reservationId', 'd.id'), set('reservationCode', 'd.code')],
  }),
  req('Vendor: reservations for the box', 'GET', '/food/vendor/kitchen/surplus-reservations?boxId={{boxId}}', {
    as: 'vendorToken',
    tests: ["pm.test('one reserved', () => pm.expect(d[0].status).to.eql('reserved'));"],
  }),
  req('Vendor: collected (with the code)', 'POST', '/food/vendor/kitchen/surplus-reservations/{{reservationId}}/collected', {
    as: 'vendorToken',
    ok200: true,
    body: { code: '{{reservationCode}}' },
    tests: ["pm.test('collected', () => pm.expect(d.status).to.eql('collected'));"],
  }),
  req('Vendor: a donation', 'POST', '/food/vendor/kitchen/donations', {
    as: 'vendorToken',
    body: { organisation: 'Edhi Centre, Model Town', meals: 12 },
    tests: ["pm.test('meals rescued counts boxes and donations', () => pm.expect(d.mealsRescued).to.be.at.least(13));"],
  }),
  req('Vendor: cancel the box', 'POST', '/food/vendor/kitchen/surplus-boxes/{{boxId}}/cancel', {
    as: 'vendorToken',
    ok200: true,
    tests: ["pm.test('cancelled', () => pm.expect(d.status).to.eql('cancelled'));"],
  }),
]);

// ── 7 · Staff ──
const staff = folder('7 · Staff: PBS weekly prices (SPI)', [
  req('SPI CSV import (two cities)', 'POST', '/admin/kitchen/reference-prices/import', {
    as: 'adminAccessToken',
    ok200: true,
    body: { csv: 'week_ending,city,item,unit,price\n2026-10-15,Lahore,Garlic,kg,620\n2026-10-15,Karachi,Garlic,kg,650\n2026-10-15,Lahore,Ginger,tin,700' },
    tests: ["pm.test('2 prices, 1 bad row by line', () => { pm.expect(d.prices).to.eql(2); pm.expect(d.rejected).to.eql(1); pm.expect(d.errors[0].line).to.eql(4); });"],
  }),
  req('Reference items', 'GET', '/admin/kitchen/reference-items?q=Garlic', {
    as: 'adminAccessToken',
    tests: ["pm.test('garlic, mapped to the alias canonical', () => pm.expect(d[0]).to.include({ name: 'Garlic', canonical: 'garlic' }));"],
  }),
  req('Vendor calling staff routes → 403', 'GET', '/admin/kitchen/reference-items', { as: 'vendorToken', status: 403 }),
]);

const collection = {
  info: {
    name: 'MetroMatrix — Chunk 5 (Kitchen Intelligence)',
    description:
      'Kitchen stock, recipes, purchases, costing, price watch, waste, forecast and prep, smart ETA, outage pause, Bachat Box, voice and the announcement. Needs seed:food + seed:kitchen and a server with AI_ENABLED=false (generated by scripts/gen-kitchen-postman.mjs).',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  event: food.event,
  variable: [
    'vendorToken', 'vendorBrandId', 'customerToken', 'runId', 'customerEmail', 'customerOtp', 'mailpitQuery', 'addressId',
    'riceId', 'eggsId', 'categoryId', 'dishId', 'supplierId', 'purchaseId', 'forecastId', 'forecastDate', 'checkoutKey',
    'orderId', 'orderCode', 'pickupFrom', 'pickupTo', 'boxId', 'reserveKey', 'reservationId', 'reservationCode',
    'challengeToken', 'totpCode', 'adminAccessToken',
  ].map((key) => ({ key, value: '' })),
  item: [setup, stock, recipes, money, forecast, orders, surplus, staff],
};
writeFileSync(join(root, 'postman/MetroMatrix-Kitchen.postman_collection.json'), JSON.stringify(collection, null, 2) + '\n');
console.log(`postman/MetroMatrix-Kitchen.postman_collection.json: ${collection.item.reduce((s, f) => s + f.item.length, 0)} requests`);
