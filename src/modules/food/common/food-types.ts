export const FULFILMENTS = ['delivery', 'pickup'] as const;
export type Fulfilment = (typeof FULFILMENTS)[number];

/** Customers pay the vendor directly — MetroMatrix never holds money. */
export const FOOD_PAYMENT_METHODS = [
  'cod',
  'transfer',
  'pay_at_pickup',
] as const;
export type CustomerPaymentMethod = (typeof FOOD_PAYMENT_METHODS)[number];

/**
 * Every way an order can be settled. The customer chooses from
 * FOOD_PAYMENT_METHODS at checkout; `subscription` (a tiffin meal, covered by
 * the period's payment) and `catering` (the advance paid, the rest at the
 * event) are set by the orders the system writes (Chunk 5).
 */
export const ORDER_PAYMENT_METHODS = [
  ...FOOD_PAYMENT_METHODS,
  'subscription',
  'catering',
] as const;
export type FoodPaymentMethod = (typeof ORDER_PAYMENT_METHODS)[number];

/** Where an order came from (Chunk 5): "Orders you brought" counts storefront and QR. */
export const ORDER_SOURCES = [
  'app',
  'storefront',
  'qr',
  'tiffin',
  'catering',
  'surplus',
] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];
