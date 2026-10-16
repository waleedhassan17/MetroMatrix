import {
  invalidTransition,
  stateMachine,
} from '../../../common/state/transitions';
import { AppointmentActor } from './appointment-status';

export const PAYMENT_METHODS = ['pay_at_clinic', 'transfer'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = [
  'unpaid',
  'awaiting_transfer',
  'proof_submitted',
  'paid',
  'void',
  'refund_due',
  'refunded',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * pay_at_clinic: unpaid ─▶ paid (doctor, at completion) · ─▶ void (cancel / no-show)
 * transfer:      awaiting_transfer ─▶ proof_submitted ─▶ paid
 *                        ▲                  │ rejected
 *                        └──────────────────┘          (─▶ void on cancel)
 * paid ─▶ refund_due ─▶ refunded  (cancelled after payment; recorded, off-platform)
 * paid / proof_submitted ─▶ void   (system only: carried over to a rescheduled appointment)
 */
export const PAYMENT_STATUS = stateMachine<PaymentStatus>({
  unpaid: ['paid', 'void'],
  awaiting_transfer: ['proof_submitted', 'paid', 'void'],
  proof_submitted: ['paid', 'awaiting_transfer', 'refund_due', 'void'],
  paid: ['refund_due', 'void'],
  refund_due: ['refunded'],
  void: [],
  refunded: [],
});

const ACTORS: Partial<
  Record<`${PaymentStatus}>${PaymentStatus}`, readonly AppointmentActor[]>
> = {
  'unpaid>paid': ['doctor'],
  'unpaid>void': ['patient', 'doctor', 'system', 'admin'],
  'awaiting_transfer>proof_submitted': ['patient'],
  'awaiting_transfer>paid': ['doctor'],
  'awaiting_transfer>void': ['patient', 'doctor', 'system', 'admin'],
  'proof_submitted>paid': ['doctor'],
  'proof_submitted>awaiting_transfer': ['doctor'],
  'proof_submitted>refund_due': ['patient', 'doctor', 'system', 'admin'],
  'paid>refund_due': ['patient', 'doctor', 'system', 'admin'],
  // Only a reschedule does these: the payment moved to the new appointment.
  'paid>void': ['system'],
  'proof_submitted>void': ['system'],
  'refund_due>refunded': ['doctor'],
};

export const allowedPaymentMoves = (
  from: PaymentStatus,
  actor: AppointmentActor,
): PaymentStatus[] =>
  PAYMENT_STATUS.allowed(from).filter((to) =>
    ACTORS[`${from}>${to}`]?.includes(actor),
  );

export function assertPaymentTransition(
  from: PaymentStatus,
  to: PaymentStatus,
  actor: AppointmentActor,
  message?: string,
): void {
  const allowed = allowedPaymentMoves(from, actor);
  if (!allowed.includes(to))
    throw invalidTransition(from, to, allowed, message);
}

/** What a cancel does to the payment. */
export const PAYMENT_ON_CANCEL: Partial<Record<PaymentStatus, PaymentStatus>> =
  {
    unpaid: 'void',
    awaiting_transfer: 'void',
    proof_submitted: 'refund_due',
    paid: 'refund_due',
  };

/** A no-show forfeits nothing already paid; anything outstanding is void. */
export const PAYMENT_ON_NO_SHOW: Partial<Record<PaymentStatus, PaymentStatus>> =
  {
    unpaid: 'void',
    awaiting_transfer: 'void',
  };
