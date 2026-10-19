import {
  invalidTransition,
  stateMachine,
} from '../../../common/state/transitions';
import type { Fulfilment } from '../common/food-types';

export const FOOD_ORDER_STATUSES = [
  'placed',
  'accepted',
  'preparing',
  'ready',
  'on_the_way',
  'delivered',
  'picked_up',
  'rejected',
  'auto_rejected',
  'cancelled',
] as const;
export type FoodOrderStatus = (typeof FOOD_ORDER_STATUSES)[number];

export const FOOD_ACTORS = [
  'customer',
  'vendor',
  'rider',
  'system',
  'admin',
] as const;
export type FoodActorRole = (typeof FOOD_ACTORS)[number];

/**
 * placed ──▶ accepted ──▶ preparing ──▶ ready ──▶ on_the_way ──▶ delivered
 *   │                                    └──(pickup)──▶ picked_up
 *   ├─▶ rejected · auto_rejected · cancelled
 * accepted | preparing | ready ──▶ cancelled
 */
export const FOOD_ORDER_STATUS = stateMachine<FoodOrderStatus>({
  placed: ['accepted', 'rejected', 'auto_rejected', 'cancelled'],
  accepted: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['on_the_way', 'picked_up', 'cancelled'],
  on_the_way: ['delivered'],
  delivered: [],
  picked_up: [],
  rejected: [],
  auto_rejected: [],
  cancelled: [],
});

/**
 * Who may make each move. The customer cancels only while the order is
 * `placed`; the system auto-rejects and cancels unpaid transfers; a vendor
 * may cancel a ready order too (a pickup that is never collected).
 */
const ACTORS: Partial<
  Record<`${FoodOrderStatus}>${FoodOrderStatus}`, readonly FoodActorRole[]>
> = {
  // The system accepts the orders it writes for an accepted tiffin or catering booking.
  'placed>accepted': ['vendor', 'system'],
  'placed>rejected': ['vendor'],
  'placed>auto_rejected': ['system'],
  'placed>cancelled': ['customer', 'system', 'admin'],
  'accepted>preparing': ['vendor'],
  'accepted>cancelled': ['vendor', 'system', 'admin'],
  'preparing>ready': ['vendor'],
  'preparing>cancelled': ['vendor', 'admin'],
  'ready>on_the_way': ['vendor', 'rider'],
  'ready>picked_up': ['vendor'],
  'ready>cancelled': ['vendor', 'admin'],
  'on_the_way>delivered': ['vendor', 'rider'],
};

/** Moves that only make sense for one fulfilment. */
const ONLY_FOR: Partial<Record<FoodOrderStatus, Fulfilment>> = {
  on_the_way: 'delivery',
  delivered: 'delivery',
  picked_up: 'pickup',
};

export const allowedFoodMoves = (
  from: FoodOrderStatus,
  actor: FoodActorRole,
  fulfilment: Fulfilment,
): FoodOrderStatus[] =>
  FOOD_ORDER_STATUS.allowed(from).filter(
    (to) =>
      ACTORS[`${from}>${to}`]?.includes(actor) &&
      (!ONLY_FOR[to] || ONLY_FOR[to] === fulfilment),
  );

/** 409 INVALID_TRANSITION { from, to, allowed } unless `actor` may move this order `from → to`. */
export function assertFoodTransition(
  from: FoodOrderStatus,
  to: FoodOrderStatus,
  actor: FoodActorRole,
  fulfilment: Fulfilment,
  message?: string,
): void {
  const allowed = allowedFoodMoves(from, actor, fulfilment);
  if (!allowed.includes(to))
    throw invalidTransition(from, to, allowed, message);
}

/** The spec's names. */
export const assertTransition = assertFoodTransition;

/** Ended without food changing hands: portions and promotion use go back. */
export const NEGATIVE_END: readonly FoodOrderStatus[] = [
  'rejected',
  'auto_rejected',
  'cancelled',
];
export const TERMINAL: readonly FoodOrderStatus[] = [
  'delivered',
  'picked_up',
  ...NEGATIVE_END,
];
/** Still needs someone to act. */
export const ACTIVE_STATUSES: readonly FoodOrderStatus[] = [
  'placed',
  'accepted',
  'preparing',
  'ready',
  'on_the_way',
];

/** The timestamp column each status stamps. */
export const STATUS_TIMESTAMP: Partial<Record<FoodOrderStatus, string>> = {
  accepted: 'acceptedAt',
  preparing: 'preparingAt',
  ready: 'readyAt',
  on_the_way: 'pickedUpAt',
  picked_up: 'pickedUpAt',
  delivered: 'deliveredAt',
  rejected: 'cancelledAt',
  auto_rejected: 'cancelledAt',
  cancelled: 'cancelledAt',
};

export const STATUS_LABEL: Record<FoodOrderStatus, string> = {
  placed: 'Waiting for the restaurant',
  accepted: 'Accepted',
  preparing: 'Being prepared',
  ready: 'Ready',
  on_the_way: 'On the way',
  delivered: 'Delivered',
  picked_up: 'Collected',
  rejected: 'Declined by the restaurant',
  auto_rejected: 'Not accepted in time',
  cancelled: 'Cancelled',
};
