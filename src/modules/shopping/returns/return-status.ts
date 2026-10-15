import { invalidTransition, stateMachine } from '../common/transitions';

export const RETURN_STATUSES = [
  'requested',
  'approved',
  'rejected',
  'received',
  'refunded',
] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

/** A request still in progress — at most one per store order (partial unique index). */
export const OPEN_RETURN_STATUSES = [
  'requested',
  'approved',
  'received',
] as const;

export const RETURN_REASONS = [
  'wrong_item',
  'damaged',
  'size_issue',
  'not_as_described',
  'other',
] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];

/**
 * requested ─▶ approved ─▶ received ─▶ refunded
 *     └──────▶ rejected (note required)
 * Every move is the store's.
 */
export const RETURN_STATUS = stateMachine<ReturnStatus>({
  requested: ['approved', 'rejected'],
  approved: ['received'],
  received: ['refunded'],
  rejected: [],
  refunded: [],
});

export const ALLOWED_TRANSITIONS = RETURN_STATUS.map;

export function assertTransition(
  from: ReturnStatus,
  to: ReturnStatus,
  message?: string,
): void {
  if (!RETURN_STATUS.can(from, to))
    throw invalidTransition(from, to, RETURN_STATUS.allowed(from), message);
}
