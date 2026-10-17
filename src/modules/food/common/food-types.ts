export const FULFILMENTS = ['delivery', 'pickup'] as const;
export type Fulfilment = (typeof FULFILMENTS)[number];

/** Customers pay the vendor directly — MetroMatrix never holds money. */
export const FOOD_PAYMENT_METHODS = [
  'cod',
  'transfer',
  'pay_at_pickup',
] as const;
export type FoodPaymentMethod = (typeof FOOD_PAYMENT_METHODS)[number];
