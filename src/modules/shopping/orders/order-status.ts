import {
  invalidTransition,
  stateMachine,
} from '../../../common/state/transitions';

export const ORDER_STATUSES = [
  'placed',
  'confirmed',
  'packed',
  'shipped',
  'delivered',
  'completed',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ACTOR_ROLES = ['customer', 'store', 'system', 'admin'] as const;
export type ActorRole = (typeof ACTOR_ROLES)[number];

/**
 * placed ─▶ confirmed ─▶ packed ─▶ shipped ─▶ delivered ─▶ completed
 *   └──────────┴───────────┴─▶ cancelled
 */
export const ORDER_STATUS = stateMachine<OrderStatus>({
  placed: ['confirmed', 'cancelled'],
  confirmed: ['packed', 'cancelled'],
  packed: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: ['completed'],
  completed: [],
  cancelled: [],
});

/**
 * Who may make each move. A customer cancels only before the store confirms
 * (afterwards they can only *request* it); the store ships and confirms;
 * the system cancels unpaid transfers and completes delivered orders.
 */
const ORDER_ACTORS: Partial<
  Record<`${OrderStatus}>${OrderStatus}`, readonly ActorRole[]>
> = {
  'placed>confirmed': ['store'],
  'placed>cancelled': ['customer', 'store', 'system', 'admin'],
  'confirmed>packed': ['store'],
  'confirmed>cancelled': ['store', 'system', 'admin'],
  'packed>shipped': ['store'],
  'packed>cancelled': ['store', 'system', 'admin'],
  'shipped>delivered': ['store', 'customer'],
  'delivered>completed': ['system'],
};

/** Where this actor may move an order from `from`. */
export const allowedOrderMoves = (
  from: OrderStatus,
  actor: ActorRole,
): OrderStatus[] =>
  ORDER_STATUS.allowed(from).filter((to) =>
    ORDER_ACTORS[`${from}>${to}`]?.includes(actor),
  );

/** Throws 409 INVALID_TRANSITION { from, to, allowed } unless `actor` may move `from → to`. */
export function assertOrderTransition(
  from: OrderStatus,
  to: OrderStatus,
  actor: ActorRole,
  message?: string,
): void {
  const allowed = allowedOrderMoves(from, actor);
  if (!allowed.includes(to))
    throw invalidTransition(from, to, allowed, message);
}

/** The spec's names: the transitions map and its guard. */
export const ALLOWED_TRANSITIONS = ORDER_STATUS.map;
export const assertTransition = assertOrderTransition;

/** Customer-facing buckets for GET /orders?status=. */
export const ORDER_BUCKETS = {
  active: ['placed', 'confirmed', 'packed', 'shipped'],
  completed: ['delivered', 'completed'],
  cancelled: ['cancelled'],
} as const satisfies Record<string, readonly OrderStatus[]>;

/** The timestamp column each status stamps. */
export const STATUS_TIMESTAMP: Partial<Record<OrderStatus, string>> = {
  confirmed: 'confirmedAt',
  packed: 'packedAt',
  shipped: 'shippedAt',
  delivered: 'deliveredAt',
  completed: 'completedAt',
  cancelled: 'cancelledAt',
};
