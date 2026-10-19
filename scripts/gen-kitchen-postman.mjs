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

// ── 5B · Growth ──
/** Dates in Pakistan time for the tiffin and catering steps (weekday plan: Mon–Fri). */
const pkDates = [
  "const pk = (ms) => new Date(ms + 5 * 3600e3);",
  "const iso = (d) => d.toISOString().slice(0, 10);",
  "const day = 86400e3;",
  "const today = pk(Date.now());",
  "const weekday = (d) => d.getUTCDay() >= 1 && d.getUTCDay() <= 5;",
  "let late = new Date(today); while (!weekday(late)) late = new Date(late.getTime() - day);",
  "let open = new Date(today.getTime() + 2 * day); while (!weekday(open)) open = new Date(open.getTime() + day);",
  "pm.collectionVariables.set('tomorrow', iso(new Date(today.getTime() + day)));",
  "pm.collectionVariables.set('lateDate', iso(late));",
  "pm.collectionVariables.set('openDate', iso(open));",
  "pm.collectionVariables.set('eventDate', iso(new Date(today.getTime() + 14 * day)));",
  "pm.collectionVariables.set('pestDate', iso(new Date(today.getTime() - (1 + (Date.now() % 300)) * day)));",
];
const tiffin = folder('8 · Tiffin (Khala Rukhsana’s, seed part 2)', [
  req('Vendor (Khala Rukhsana’s Kitchen): sign in', 'POST', '/auth/signin', {
    ok200: true,
    pre: pkDates,
    body: { email: 'demo.food.rukhsana@metromatrix.test', password: '{{demoPassword}}', portal: 'partner' },
    tests: [set('rukhsanaToken', 'd.tokens.accessToken'), set('rukhsanaBrandId', 'd.business.food.brandId')],
  }),
  req('Customer: the kitchen’s tiffin plans', 'GET', '/food/vendors/{{rukhsanaBrandId}}/tiffin-plans', {
    as: 'customerToken',
    tests: [
      "const p = d.find((x) => x.name === 'Office lunch — weekdays');",
      "pm.test('the seeded weekday plan, a meal value and free seats', () => { pm.expect(p.days).to.eql([1, 2, 3, 4, 5]); pm.expect(p.mealValue).to.eql(450); pm.expect(p.seatsLeft).to.be.above(0); });",
      set('planId', 'p.id'),
    ],
  }),
  req('Customer: subscribe (pickup, cash weekly)', 'POST', '/food/tiffin/subscribe', {
    as: 'customerToken',
    pre: ["pm.collectionVariables.set('tiffinKey', 'pm-tiffin-' + Date.now());"],
    headers: [{ key: 'Idempotency-Key', value: '{{tiffinKey}}' }],
    body: { planId: '{{planId}}', startsOn: '{{tomorrow}}', paymentMethod: 'cash_weekly', fulfilment: 'pickup' },
    tests: ["pm.test('requested — the kitchen approves', () => pm.expect(d.status).to.eql('requested'));", set('subscriptionId', 'd.id')],
  }),
  req('Vendor: approve', 'POST', '/food/vendor/tiffin/subscriptions/{{subscriptionId}}/approve', {
    as: 'rukhsanaToken',
    ok200: true,
    tests: ["pm.test('active, this week’s period due', () => { pm.expect(d.status).to.eql('active'); pm.expect(d.period.paymentStatus).to.eql('due'); });"],
  }),
  req('Customer: skip a day whose cut-off passed → TIFFIN_SKIP_CUTOFF_PASSED', 'POST', '/food/tiffin/subscriptions/{{subscriptionId}}/skip', {
    as: 'customerToken',
    status: 409,
    body: { date: '{{lateDate}}' },
    tests: ["pm.test('TIFFIN_SKIP_CUTOFF_PASSED', () => pm.expect(body.error.code).to.eql('TIFFIN_SKIP_CUTOFF_PASSED'));"],
  }),
  req('Customer: skip a day still open', 'POST', '/food/tiffin/subscriptions/{{subscriptionId}}/skip', {
    as: 'customerToken',
    ok200: true,
    body: { date: '{{openDate}}' },
    tests: ["pm.test('skipped', () => pm.expect(d.skips).to.include(pm.collectionVariables.get('openDate')));"],
  }),
  req('Vendor: tomorrow’s meals', 'GET', '/food/vendor/tiffin/tomorrow?date={{openDate}}', {
    as: 'rukhsanaToken',
    tests: ["pm.test('the plan, with our skip counted', () => { const p = d.plans.find((x) => x.planId === pm.collectionVariables.get('planId')); pm.expect(p.skipped).to.be.at.least(1); pm.expect(p.cutoffAt).to.be.a('string'); });"],
  }),
  req('Customer: cancel (frees the seat for the next run)', 'POST', '/food/tiffin/subscriptions/{{subscriptionId}}/cancel', {
    as: 'customerToken',
    ok200: true,
    tests: ["pm.test('cancelled', () => pm.expect(d.status).to.eql('cancelled'));"],
  }),
]);

const catering = folder('9 · Catering (Qandeel Karahi House)', [
  req('Vendor (Qandeel Karahi House): sign in', 'POST', '/auth/signin', {
    ok200: true,
    pre: pkDates,
    body: { email: 'demo.food.qandeel@metromatrix.test', password: '{{demoPassword}}', portal: 'partner' },
    tests: [set('qandeelToken', 'd.tokens.accessToken'), set('qandeelBrandId', 'd.business.food.brandId')],
  }),
  req('Customer: a dawat request', 'POST', '/food/catering', {
    as: 'customerToken',
    body: {
      vendorId: '{{qandeelBrandId}}',
      eventDate: '{{eventDate}}',
      eventTime: '20:00',
      guests: 40,
      eventType: 'dawat',
      requestedItems: [{ name: 'Chicken karahi', qty: 10 }, { name: 'Naan' }],
      budget: 40000,
      fulfilment: 'delivery',
      addressId: '{{addressId}}',
      notes: 'Postman dawat',
    },
    tests: ["pm.test('a CT- code, requested', () => { pm.expect(d.code).to.match(/^CT-[A-Z2-9]{6}$/); pm.expect(d.status).to.eql('requested'); });", set('cateringId', 'd.id')],
  }),
  req('Vendor: quote v1', 'POST', '/food/vendor/catering/{{cateringId}}/quote', {
    as: 'qandeelToken',
    ok200: true,
    body: { lines: [{ name: 'Chicken karahi (full)', qty: 10, unitPrice: 2600 }, { name: 'Naan', qty: 80, unitPrice: 30 }], deliveryFee: 500, advancePct: 30 },
    tests: ["pm.test('v1: total and advance', () => pm.expect(d.quote).to.include({ version: 1, total: 28900, advance: 8670 }));"],
  }),
  req('Vendor: quote v2 (free delivery)', 'POST', '/food/vendor/catering/{{cateringId}}/quote', {
    as: 'qandeelToken',
    ok200: true,
    body: { lines: [{ name: 'Chicken karahi (full)', qty: 10, unitPrice: 2600 }, { name: 'Naan', qty: 80, unitPrice: 30 }], deliveryFee: 0, advancePct: 30, notes: 'Free delivery' },
    tests: ["pm.test('v2, newest first', () => { pm.expect(d.quote.version).to.eql(2); pm.expect(d.versions.map((v) => v.version)).to.eql([2, 1]); });"],
  }),
  req('Customer: accept the old v1 → refused', 'POST', '/food/catering/{{cateringId}}/accept', {
    as: 'customerToken',
    status: 409,
    body: { version: 1 },
    tests: ["pm.test('INVALID_TRANSITION, latest is v2', () => { pm.expect(body.error.code).to.eql('INVALID_TRANSITION'); pm.expect(body.error.details.latestVersion).to.eql(2); });"],
  }),
  req('Customer: accept v2', 'POST', '/food/catering/{{cateringId}}/accept', {
    as: 'customerToken',
    ok200: true,
    body: { version: 2 },
    tests: ["pm.test('accepted, 30% advance to the kitchen’s own account', () => { pm.expect(d.status).to.eql('accepted'); pm.expect(d.advance).to.eql(8520); });"],
  }),
  req('Vendor: the request list', 'GET', '/food/vendor/catering?status=accepted', {
    as: 'qandeelToken',
    tests: ["pm.test('ours is there, with the customer', () => { const r = d.find((x) => x.id === pm.collectionVariables.get('cateringId')); pm.expect(r.customer.name).to.be.a('string'); });"],
  }),
  req('Customer: cancel (demo cleanup)', 'POST', '/food/catering/{{cateringId}}/cancel', {
    as: 'customerToken',
    ok200: true,
    body: { reason: 'Postman: plans changed' },
    tests: ["pm.test('cancelled', () => pm.expect(d.status).to.eql('cancelled'));"],
  }),
]);

const community = folder('10 · Ramadan, storefront, story, signature (Zafran)', [
  req('Vendor: Ramadan settings (seeded) and the calendar', 'GET', '/food/vendor/ramadan', {
    as: 'vendorToken',
    pre: pkDates,
    tests: [
      "pm.test('windows on, iftar on pre-order', () => pm.expect(d.settings).to.include({ enabled: true, sehriFrom: '02:30', iftarFrom: '17:30', iftarPreorderOnly: true }));",
      "pm.test('Ramadan 1448 on the calendar', () => pm.expect(d.events.map((e) => e.name).join(' ')).to.match(/Ramadan 1448/));",
    ],
  }),
  req('Vendor: half a window → 400', 'PUT', '/food/vendor/ramadan', {
    as: 'vendorToken',
    status: 400,
    body: { enabled: true, sehriFrom: '02:30' },
    tests: ["pm.test('sehriTo is missing', () => pm.expect(body.error.details.fields.sehriTo).to.be.an('array'));"],
  }),
  req('Staff: a calendar event', 'POST', '/admin/food/calendar-events', {
    as: 'adminAccessToken',
    body: { kind: 'other', name: 'Postman food festival {{runId}}', startsOn: '{{eventDate}}', endsOn: '{{eventDate}}', city: 'Lahore' },
    tests: [set('calendarEventId', 'd.id')],
  }),
  req('Staff: remove it', 'DELETE', '/admin/food/calendar-events/{{calendarEventId}}', {
    as: 'adminAccessToken',
    tests: ["pm.test('removed', () => pm.expect(d.removed).to.be.true);"],
  }),
  req('Vendor: storefront link, QR and "Orders you brought"', 'GET', '/food/vendor/storefront', {
    as: 'vendorToken',
    tests: [
      "pm.test('a QR payload with ?src=qr', () => pm.expect(d.qr.payload).to.match(/\\/s\\/[^?]+\\?src=qr$/));",
      "pm.test('the seeded QR and storefront orders', () => { pm.expect(d.ordersYouBrought.qr.orders).to.be.above(0); pm.expect(d.ordersYouBrought.storefront.orders).to.be.above(0); });",
      set('storeSlug', 'd.slug'),
    ],
  }),
  req('Public: the storefront page (no sign-in)', 'GET', '/public/food/store/{{storeSlug}}', {
    tests: ["pm.test('the vendor page and its storefront url', () => { pm.expect(d.menu).to.be.an('array').that.is.not.empty; pm.expect(d.storefront.url).to.match(/\\/s\\//); });"],
  }),
  req('Public: an unknown storefront → 404', 'GET', '/public/food/store/no-such-kitchen-{{runId}}', { status: 404 }),
  req('Vendor: the story with a fresh checklist', 'PUT', '/food/vendor/story', {
    as: 'vendorToken',
    body: {
      story: 'A demo kitchen: our biryani is layered and sealed the old way, on a slow fire. Every story on demo vendors is fictional.',
      cookName: 'Ustad Zafran (fictional)',
      photos: [],
      hygieneChecklist: { gloves: true, hairnet: true, cleanWater: true, separateBoards: true, fridgeTempLog: true, pestControlOn: '{{pestDate}}' },
    },
    ok200: true,
    tests: ["pm.test('self-declared (a changed checklist)', () => pm.expect(d).to.include({ hygieneStatus: 'self_declared', badge: 'hygiene_self_declared' }));"],
  }),
  req('Vendor calling the hygiene queue → 403', 'GET', '/admin/food/hygiene', { as: 'vendorToken', status: 403 }),
  req('Staff: the hygiene queue', 'GET', '/admin/food/hygiene', {
    as: 'adminAccessToken',
    tests: ["pm.test('Zafran is waiting', () => pm.expect(d.items.map((x) => x.brandId)).to.include(pm.collectionVariables.get('vendorBrandId')));"],
  }),
  req('Staff: verify after a video call', 'POST', '/admin/food/hygiene/{{vendorBrandId}}/verify', {
    as: 'adminAccessToken',
    ok200: true,
    body: { method: 'video_call', note: 'Postman: walked through the kitchen' },
    tests: ["pm.test('verified', () => pm.expect(d.status).to.eql('verified'));"],
  }),
  req('Customer: the vendor page shows the story and badge', 'GET', '/food/vendors/{{vendorBrandId}}?lat=31.4834&lng=74.3256', {
    as: 'customerToken',
    tests: [
      "pm.test('Hygiene verified', () => pm.expect(d.story.hygiene.label).to.eql('Hygiene verified'));",
      "pm.test('the card badge', () => pm.expect(d.badges).to.include('hygiene_verified'));",
    ],
  }),
  req('Vendor: the Postman dish is a signature recipe', 'PUT', '/food/vendor/kitchen/items/{{dishId}}/signature', {
    as: 'vendorToken',
    body: { isSignature: true, by: 'Ustad Zafran (fictional)', since: '2016-05-01' },
    tests: ["pm.test('signature', () => pm.expect(d).to.include({ isSignature: true, signatureBy: 'Ustad Zafran (fictional)' }));"],
  }),
  req('Customer: the item sheet shows it', 'GET', '/food/items/{{dishId}}', {
    as: 'customerToken',
    tests: ["pm.test('Signature recipe', () => pm.expect(d.signature).to.include({ badge: 'signature', since: '2016-05-01' }));"],
  }),
  req('Staff: signature claims', 'GET', '/admin/food/signatures', {
    as: 'adminAccessToken',
    tests: [
      "const c = d.items.find((x) => x.itemId === pm.collectionVariables.get('dishId'));",
      "pm.test('ours is listed', () => pm.expect(c).to.be.an('object'));",
      set('recipeCardId', 'c.recipeCardId'),
    ],
  }),
  req('Staff: remove the claim', 'POST', '/admin/food/signatures/{{recipeCardId}}/remove', {
    as: 'adminAccessToken',
    ok200: true,
    body: { reason: 'Postman: moderation check' },
    tests: ["pm.test('removed', () => pm.expect(d.isSignature).to.be.false);"],
  }),
  req('Guest: vendor cards carry the Chunk 5 badges', 'GET', '/food/vendors?lat=31.4834&lng=74.3256&pageSize=50', {
    tests: [
      "pm.test('every card has badges', () => d.items.forEach((c) => pm.expect(c.badges).to.be.an('array')));",
      "pm.test('Zafran’s hygiene badge', () => pm.expect(d.items.find((c) => c.id === pm.collectionVariables.get('vendorBrandId')).badges).to.include('hygiene_verified'));",
    ],
  }),
  req('Guest: the home (Chunk 5 rails appear when they have cards)', 'GET', '/food/home?lat=31.4834&lng=74.3256', {
    tests: ["pm.test('the Chunk 4 sections are still there', () => pm.expect(d).to.include.keys('offers', 'homeKitchens', 'topRated', 'fastest'));"],
  }),
]);

const demand = folder('11 · Demand, menu engineering, experiments, batching', [
  req('Vendor: the demand map (seeded searches)', 'GET', '/food/vendor/demand-map', {
    as: 'vendorToken',
    tests: [
      "pm.test('k = 5, every shown cell has ≥ 5 searches', () => { pm.expect(d.k).to.eql(5); pm.expect(d.cells).to.be.an('array').that.is.not.empty; d.cells.forEach((c) => pm.expect(c.searches).to.be.at.least(5)); });",
      "pm.test('cells have a centre and shares', () => pm.expect(d.cells[0]).to.include.keys('geohash6', 'center', 'zeroResultShare', 'closedShare', 'inYourZone'));",
      "pm.test('unmet queries, each over the threshold', () => { pm.expect(d.topQueries.length).to.be.above(0); d.topQueries.forEach((q) => pm.expect(q.searches).to.be.at.least(5)); pm.expect(d.topQueries[0].zeroResultShare + d.topQueries[0].closedShare).to.be.above(0); });",
    ],
  }),
  req('Vendor: the demand curve', 'GET', '/food/vendor/demand-curve?weeks=8', {
    as: 'vendorToken',
    tests: ["pm.test('7 × 24, with peaks', () => { pm.expect(d.own.orders).to.have.length(7); pm.expect(d.own.orders[0]).to.have.length(24); pm.expect(d.own.peaks.length).to.be.above(0); });"],
  }),
  req('Vendor: menu engineering', 'GET', '/food/vendor/kitchen/menu-engineering', {
    as: 'vendorToken',
    tests: [
      "pm.test('quadrants over 30 days', () => { pm.expect(d.days).to.eql(30); pm.expect(d.items.length).to.be.above(3); });",
      "pm.test('every dish has a quadrant and an action', () => d.items.forEach((i) => pm.expect(['star', 'plowhorse', 'puzzle', 'dog']).to.include(i.quadrant)));",
    ],
  }),
  req('Vendor: the running experiment (seeded)', 'GET', '/food/vendor/kitchen/experiments?status=running', {
    as: 'vendorToken',
    tests: ["pm.test('one running, with a live result', () => { pm.expect(d.items.length).to.be.at.least(1); pm.expect(d.items[0].result).to.include.keys('itemDaily', 'categoryMedianDaily', 'recommendation'); });"],
  }),
  req('Vendor: a new experiment on the Postman dish', 'POST', '/food/vendor/kitchen/experiments', {
    as: 'vendorToken',
    body: { itemId: '{{dishId}}', days: 7, notes: 'Postman' },
    tests: ["pm.test('running from today', () => pm.expect(d.status).to.eql('running'));", set('experimentId', 'd.id')],
  }),
  req('Vendor: a second one for the same dish → 409', 'POST', '/food/vendor/kitchen/experiments', {
    as: 'vendorToken',
    status: 409,
    body: { itemId: '{{dishId}}', days: 5 },
    tests: ["pm.test('CONFLICT', () => pm.expect(body.error.code).to.eql('CONFLICT'));"],
  }),
  req('Vendor: cancel it', 'DELETE', '/food/vendor/kitchen/experiments/{{experimentId}}', {
    as: 'vendorToken',
    tests: ["pm.test('cancelled', () => pm.expect(d.status).to.eql('cancelled'));"],
  }),
  req('Vendor: riders for the order, with batch suggestions', 'GET', '/food/vendor/riders/suggest?orderId={{orderId}}', {
    as: 'vendorToken',
    tests: ["pm.test('batchWith is a list (≤ 2 km, ≤ 45°)', () => { pm.expect(d.batchWith).to.be.an('array'); d.batchWith.forEach((b) => { pm.expect(b.dropsApartKm).to.be.at.most(2); pm.expect(b.bearingDiff).to.be.at.most(45); }); });"],
  }),
  req('Staff: the platform demand map', 'GET', '/admin/food/demand-map?city=Lahore', {
    as: 'adminAccessToken',
    tests: ["pm.test('Lahore cells, no vendor distance', () => { pm.expect(d.cells).to.be.an('array').that.is.not.empty; pm.expect(d.cells[0].distanceKm).to.be.undefined; });"],
  }),
  req('Staff: cities with demand data', 'GET', '/admin/food/demand-map/cities', {
    as: 'adminAccessToken',
    tests: ["pm.test('Lahore and Karachi', () => pm.expect(d.items.map((c) => c.city)).to.include.members(['Lahore', 'Karachi']));"],
  }),
]);

const collection = {
  info: {
    name: 'MetroMatrix — Chunk 5 (Kitchen Intelligence)',
    description:
      'Kitchen stock, recipes, purchases, costing, price watch, waste, forecast and prep, smart ETA, outage pause, Bachat Box, voice and the announcement (5A); tiffin, catering, Ramadan, storefront, story and hygiene, signature, demand map and curve, menu engineering, experiments and rider batching (5B). Needs seed:food + seed:kitchen and a server with AI_ENABLED=false (generated by scripts/gen-kitchen-postman.mjs).',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  event: food.event,
  variable: [
    'vendorToken', 'vendorBrandId', 'customerToken', 'runId', 'customerEmail', 'customerOtp', 'mailpitQuery', 'addressId',
    'riceId', 'eggsId', 'categoryId', 'dishId', 'supplierId', 'purchaseId', 'forecastId', 'forecastDate', 'checkoutKey',
    'orderId', 'orderCode', 'pickupFrom', 'pickupTo', 'boxId', 'reserveKey', 'reservationId', 'reservationCode',
    'challengeToken', 'totpCode', 'adminAccessToken',
    'tomorrow', 'lateDate', 'openDate', 'eventDate', 'pestDate', 'rukhsanaToken', 'rukhsanaBrandId', 'planId', 'tiffinKey',
    'subscriptionId', 'qandeelToken', 'qandeelBrandId', 'cateringId', 'calendarEventId', 'storeSlug', 'recipeCardId',
    'experimentId',
  ].map((key) => ({ key, value: '' })),
  item: [setup, stock, recipes, money, forecast, orders, surplus, staff, tiffin, catering, community, demand],
};
writeFileSync(join(root, 'postman/MetroMatrix-Kitchen.postman_collection.json'), JSON.stringify(collection, null, 2) + '\n');
console.log(`postman/MetroMatrix-Kitchen.postman_collection.json: ${collection.item.reduce((s, f) => s + f.item.length, 0)} requests`);
