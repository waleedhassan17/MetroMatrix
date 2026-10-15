import { invalidTransition, stateMachine } from '../common/transitions';
import { ActorRole } from './order-status';

export const PAYMENT_STATUSES = [
  'cod_pending',
  'awaiting_transfer',
  'proof_submitted',
  'paid',
  'void',
  'refund_due',
  'refunded',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * cod:      cod_pending ─▶ paid (cash collected, at/after delivery) · ─▶ void (cancelled)
 * transfer: awaiting_transfer ─▶ proof_submitted ─▶ paid
 *                     ▲                 │
 *                     └── rejected ─────┘          (and ─▶ void on cancel)
 * paid ─▶ refund_due ─▶ refunded   (cancelled after payment; money moves off-platform)
 *
 * A cancel while proof is submitted but unconfirmed becomes refund_due: the
 * customer says they paid, so the store must settle it (refund, or record
 * that nothing arrived) rather than the claim silently vanishing.
 */
export const PAYMENT_STATUS = stateMachine<PaymentStatus>({
  cod_pending: ['paid', 'void'],
  awaiting_transfer: ['proof_submitted', 'paid', 'void'],
  proof_submitted: ['paid', 'awaiting_transfer', 'refund_due'],
  paid: ['refund_due'],
  refund_due: ['refunded'],
  void: [],
  refunded: [],
});

const PAYMENT_ACTORS: Partial<
  Record<`${PaymentStatus}>${PaymentStatus}`, readonly ActorRole[]>
> = {
  'cod_pending>paid': ['store'],
  'cod_pending>void': ['customer', 'store', 'system', 'admin'],
  'awaiting_transfer>proof_submitted': ['customer'],
  'awaiting_transfer>paid': ['store'],
  'awaiting_transfer>void': ['customer', 'store', 'system', 'admin'],
  'proof_submitted>paid': ['store'],
  'proof_submitted>awaiting_transfer': ['store'],
  'proof_submitted>refund_due': ['customer', 'store', 'system', 'admin'],
  'paid>refund_due': ['customer', 'store', 'system', 'admin'],
  'refund_due>refunded': ['store'],
};

export const allowedPaymentMoves = (
  from: PaymentStatus,
  actor: ActorRole,
): PaymentStatus[] =>
  PAYMENT_STATUS.allowed(from).filter((to) =>
    PAYMENT_ACTORS[`${from}>${to}`]?.includes(actor),
  );

export function assertPaymentTransition(
  from: PaymentStatus,
  to: PaymentStatus,
  actor: ActorRole,
  message?: string,
): void {
  const allowed = allowedPaymentMoves(from, actor);
  if (!allowed.includes(to))
    throw invalidTransition(from, to, allowed, message);
}

/** The spec's names: the transitions map and its guard. */
export const ALLOWED_TRANSITIONS = PAYMENT_STATUS.map;
export const assertTransition = assertPaymentTransition;

/** What a cancel does to the payment, by its current state. */
export const PAYMENT_ON_CANCEL: Partial<Record<PaymentStatus, PaymentStatus>> =
  {
    cod_pending: 'void',
    awaiting_transfer: 'void',
    proof_submitted: 'refund_due',
    paid: 'refund_due',
  };
