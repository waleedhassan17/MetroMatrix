import {
  invalidTransition,
  stateMachine,
} from '../../../common/state/transitions';
import type { FoodActorRole } from './food-order-status';
import type { FoodPaymentMethod } from '../common/food-types';

export const FOOD_PAYMENT_STATUSES = [
  'cod_pending',
  'unpaid',
  'awaiting_transfer',
  'proof_submitted',
  'paid',
  'void',
  'refund_due',
  'refunded',
] as const;
export type FoodPaymentStatus = (typeof FOOD_PAYMENT_STATUSES)[number];

/**
 * cod:            cod_pending ─▶ paid (on delivered)
 * pay_at_pickup:  unpaid ─▶ paid (on picked_up)
 * transfer:       awaiting_transfer ─▶ proof_submitted ─▶ paid
 *                                         └─(rejected)─▶ awaiting_transfer
 * cancelled before paying ─▶ void · after paying ─▶ refund_due ─▶ refunded
 * MetroMatrix holds nothing: "refund_due" is what the vendor owes back.
 */
export const FOOD_PAYMENT_STATUS = stateMachine<FoodPaymentStatus>({
  cod_pending: ['paid', 'void'],
  unpaid: ['paid', 'void'],
  awaiting_transfer: ['proof_submitted', 'paid', 'void'],
  proof_submitted: ['paid', 'awaiting_transfer', 'void'],
  paid: ['refund_due'],
  refund_due: ['refunded'],
  void: [],
  refunded: [],
});

const ANYONE: readonly FoodActorRole[] = [
  'customer',
  'vendor',
  'rider',
  'system',
  'admin',
];
const ACTORS: Partial<
  Record<`${FoodPaymentStatus}>${FoodPaymentStatus}`, readonly FoodActorRole[]>
> = {
  'cod_pending>paid': ['vendor', 'rider', 'system'],
  'unpaid>paid': ['vendor', 'system'],
  'awaiting_transfer>proof_submitted': ['customer'],
  'awaiting_transfer>paid': ['vendor'],
  'proof_submitted>paid': ['vendor'],
  'proof_submitted>awaiting_transfer': ['vendor'],
  // Settling a cancel follows whoever cancelled.
  'cod_pending>void': ANYONE,
  'unpaid>void': ANYONE,
  'awaiting_transfer>void': ANYONE,
  'proof_submitted>void': ANYONE,
  'paid>refund_due': ANYONE,
  'refund_due>refunded': ['vendor', 'admin'],
};

export function assertFoodPaymentTransition(
  from: FoodPaymentStatus,
  to: FoodPaymentStatus,
  actor: FoodActorRole,
  message?: string,
): void {
  const allowed = FOOD_PAYMENT_STATUS.allowed(from).filter((s) =>
    ACTORS[`${from}>${s}`]?.includes(actor),
  );
  if (!allowed.includes(to))
    throw invalidTransition(from, to, allowed, message);
}

export const INITIAL_PAYMENT: Record<FoodPaymentMethod, FoodPaymentStatus> = {
  cod: 'cod_pending',
  pay_at_pickup: 'unpaid',
  transfer: 'awaiting_transfer',
};

/** Where a cancel leaves the payment. */
export const PAYMENT_ON_CANCEL: Partial<
  Record<FoodPaymentStatus, FoodPaymentStatus>
> = {
  cod_pending: 'void',
  unpaid: 'void',
  awaiting_transfer: 'void',
  proof_submitted: 'void',
  paid: 'refund_due',
};

/** Cash changes hands at the door or the counter. */
export const PAYMENT_ON_HANDOVER: Partial<
  Record<FoodPaymentStatus, FoodPaymentStatus>
> = {
  cod_pending: 'paid',
  unpaid: 'paid',
};

/** How long a customer has to pay a transfer order. */
export const TRANSFER_WINDOW_MINUTES = 10;
