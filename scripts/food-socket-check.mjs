#!/usr/bin/env node
/**
 * Food Court realtime check against a running server with seed:food data.
 *
 *   npm run socket:food                         # http://localhost:3000
 *   BASE_URL=http://localhost:3100 npm run socket:food
 *
 * Needs SEED_DEMO_PASSWORD (env or .env) — the password seed:food gave the
 * demo accounts. It places one order at the demo vendor "Sahil Tikka & Pizza
 * Oven" (scheduled for after it opens when it is closed) and walks it to
 * delivered, checking every socket event on the way:
 *
 *   - a missing or bad token is refused (connect_error UNAUTHORIZED);
 *   - the kitchen gets board.sync on connect and order.new on checkout;
 *   - the customer joins the order's room, a stranger is refused (NOT_FOUND);
 *   - the customer gets order.updated for every step, rider.location
 *     throttled (two quick fixes → one event), and order.payment;
 *   - a rider can't send location for someone else's order;
 *   - after a reconnect, REST shows the current state.
 *
 * Exits 0 when every check passes, 1 otherwise. Prints no secrets.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';

const BASE = (process.env.BASE_URL ?? 'http://localhost:3000').replace(
  /\/api\/v1\/?$/,
  '',
);
const API = `${BASE}/api/v1`;
const env = (key) => {
  if (process.env[key]) return process.env[key];
  try {
    const line = readFileSync('.env', 'utf8')
      .split('\n')
      .find((l) => l.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).trim() : undefined;
  } catch {
    return undefined;
  }
};
const PASSWORD = env('SEED_DEMO_PASSWORD');
if (!PASSWORD) {
  console.error(
    'Set SEED_DEMO_PASSWORD (env or .env) — the password seed:food gave the demo accounts.',
  );
  process.exit(1);
}

let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}`);
  if (!cond) failures += 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Each account gets its own client address (the API rate-limits by address). */
let ipSeq = 0;
function client() {
  ipSeq += 1;
  const ip = `10.250.${Math.floor(Math.random() * 200)}.${ipSeq}`;
  let token = null;
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(API + path, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': ip,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, body: json, data: json.data };
  };
  return {
    call,
    get token() {
      return token;
    },
    async signin(body) {
      const r = await call('POST', '/auth/signin', {
        password: PASSWORD,
        ...body,
      });
      if (r.status !== 200)
        throw new Error(`sign-in failed (${r.status} ${r.body?.error?.code})`);
      token = r.data.tokens.accessToken;
      return r.data;
    },
  };
}

function connect(token) {
  const socket = io(`${BASE}/food`, {
    auth: token ? { token } : {},
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
  const seen = {};
  for (const e of [
    'board.sync',
    'order.new',
    'order.updated',
    'order.payment',
    'rider.location',
  ])
    socket.on(e, (p) => (seen[e] ??= []).push(p));
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve({ socket, seen }));
    socket.once('connect_error', (err) => {
      socket.close();
      reject(err);
    });
  });
}

async function until(check, ms = 4000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) return false;
    await sleep(25);
  }
  return true;
}

async function main() {
  console.log(`Food realtime check → ${BASE}`);
  const health = await fetch(`${API}/health`).then((r) => r.json());
  ok(health?.data?.status === 'ok', 'server is up');

  console.log('Handshake');
  for (const [label, token] of [
    ['no token', undefined],
    ['a bad token', 'not-a-token'],
  ])
    try {
      await connect(token);
      ok(false, `${label} refused`);
    } catch (err) {
      ok(
        err.message === 'UNAUTHORIZED',
        `${label} → connect_error UNAUTHORIZED`,
      );
    }

  const vendor = client();
  await vendor.signin({
    email: 'demo.food.sahil@metromatrix.test',
    portal: 'partner',
  });
  const customer = client();
  await customer.signin({
    email: 'demo.foodie4@metromatrix.test',
    portal: 'customer',
  });
  const stranger = client();
  await stranger.signin({
    email: 'demo.foodie5@metromatrix.test',
    portal: 'customer',
  });
  const rider = client();
  await rider.signin({
    identifier: 'sahil-tikka-pizza-oven.asif',
    portal: 'partner',
  });

  console.log('Kitchen');
  const kitchen = await connect(vendor.token);
  ok(
    await until(() => kitchen.seen['board.sync']?.length === 1),
    'board.sync on connect',
  );

  console.log('Checkout');
  const page = await customer.call(
    'GET',
    '/food/vendors/sahil-tikka-pizza-oven',
  );
  const pizza = page.data.menu
    .flatMap((c) => c.items)
    .find((i) => i.name === 'Chicken Tikka Pizza');
  const sheet = await customer.call('GET', `/food/items/${pizza.id}`);
  const crust = sheet.data.groups.find((g) => g.name === 'Crust').options[0];
  await customer.call('DELETE', '/food/cart');
  const added = await customer.call('POST', '/food/cart/items', {
    vendorId: page.data.id,
    itemId: pizza.id,
    variantId: sheet.data.variants[0].id,
    optionIds: [crust.id],
    quantity: 1,
  });
  ok(added.status === 201, 'dish added to the cart');
  if (!page.data.openState.open) {
    const at = new Date(
      new Date(page.data.openState.opensAt).getTime() + 30 * 60_000,
    ).toISOString();
    const s = await customer.call('PATCH', '/food/cart', { scheduledFor: at });
    ok(s.status === 200, `closed now → scheduled for ${at}`);
  }
  const addresses = await customer.call('GET', '/addresses');
  const address = (addresses.data.items ?? addresses.data)[0];
  const placed = await customer.call(
    'POST',
    '/food/checkout',
    { addressId: address.id, paymentMethod: 'cod' },
    { 'Idempotency-Key': randomUUID() },
  );
  ok(
    placed.status === 201,
    `order placed (${placed.data?.code ?? placed.body?.error?.code})`,
  );
  const order = placed.data;
  ok(
    await until(() =>
      kitchen.seen['order.new']?.some((e) => e.order.id === order.id),
    ),
    'kitchen got order.new',
  );

  console.log('Rooms');
  const phone = await connect(customer.token);
  const joined = await phone.socket.emitWithAck('subscribe', {
    orderId: order.id,
  });
  ok(joined.ok === true, 'customer joined the order room');
  const snoop = await connect(stranger.token);
  const refused = await snoop.socket.emitWithAck('subscribe', {
    orderId: order.id,
  });
  ok(
    refused.ok === false && refused.code === 'NOT_FOUND',
    'another customer is refused (NOT_FOUND)',
  );

  console.log('Lifecycle');
  for (const step of ['accept', 'preparing', 'ready'])
    ok(
      (await vendor.call('POST', `/food/vendor/orders/${order.id}/${step}`, {}))
        .status === 200,
      `vendor: ${step}`,
    );
  ok(
    await until(() => phone.seen['order.updated']?.length >= 3),
    'customer got order.updated ×3 (accepted, preparing, ready)',
  );
  await rider.call('PATCH', '/food/rider/duty', { onDuty: true });
  const riderSocket = await connect(rider.token);
  const before = await riderSocket.socket.emitWithAck('rider.location', {
    orderId: order.id,
    lat: 24.817,
    lng: 67.033,
  });
  ok(
    before.ok === false && before.code === 'RIDER_NOT_ASSIGNED',
    'location for an order not yours → refused',
  );
  const suggest = await vendor.call(
    'GET',
    `/food/vendor/riders/suggest?orderId=${order.id}`,
  );
  const me = suggest.data.items.find((r) => r.fullName === 'Asif Baloch');
  ok(!!me, 'rider suggested');
  ok(
    (
      await vendor.call('POST', `/food/vendor/orders/${order.id}/assign`, {
        riderId: me.riderId,
      })
    ).status === 200,
    'vendor: assign',
  );
  ok(
    await until(() =>
      riderSocket.seen['order.updated']?.some((e) => e.orderId === order.id),
    ),
    'rider got order.updated',
  );
  ok(
    (await rider.call('POST', `/food/rider/orders/${order.id}/picked-up`, {}))
      .status === 200,
    'rider: picked up',
  );
  ok(
    await until(() =>
      phone.seen['order.updated']?.some((e) => e.status === 'on_the_way'),
    ),
    'customer: on_the_way',
  );
  const fixes = [];
  for (const lat of [24.816, 24.8175])
    fixes.push(
      await riderSocket.socket.emitWithAck('rider.location', {
        orderId: order.id,
        lat,
        lng: 67.034,
        heading: 45,
        speed: 6,
      }),
    );
  ok(
    fixes.every((f) => f.ok),
    'rider sent two fixes',
  );
  ok(
    await until(() => phone.seen['rider.location']?.length >= 1),
    'customer got rider.location',
  );
  await sleep(300);
  ok(
    phone.seen['rider.location'].length === 1,
    'fan-out throttled (two fixes → one event)',
  );
  const done = await rider.call(
    'POST',
    `/food/rider/orders/${order.id}/delivered`,
    { codCollected: order.totals.total },
  );
  ok(done.status === 200, 'rider: delivered');
  ok(
    await until(() =>
      phone.seen['order.updated']?.some((e) => e.status === 'delivered'),
    ),
    'customer: delivered',
  );

  console.log('Reconnect');
  phone.socket.close();
  const again = await connect(customer.token);
  const rest = await customer.call('GET', `/food/orders/${order.code}`);
  ok(
    rest.data.status === 'delivered' && rest.data.payment.status === 'paid',
    'REST after reconnect: delivered and paid',
  );
  const back = await vendor.call(
    'POST',
    `/food/vendor/riders/${me.riderId}/handover`,
    {
      amount: (await rider.call('GET', '/food/rider/cash')).data.balance,
    },
  );
  ok(
    back.status === 200 && back.data.balance === 0,
    'cash handed over → rider holds Rs 0',
  );
  await rider.call('PATCH', '/food/rider/duty', { onDuty: false });

  for (const s of [kitchen, snoop, riderSocket, again]) s.socket.close();
  console.log(
    failures
      ? `\n${failures} check(s) failed.`
      : `\nAll realtime checks passed (${order.code}).`,
  );
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error('food socket check FAILED:', err.message);
  process.exit(1);
});
