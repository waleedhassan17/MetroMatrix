import { ConflictException } from '@nestjs/common';
import { BusinessStatus } from './business-types';
import { ErrorCode } from '../../common/errors/codes';

/**
 * Every legal business status change, in one place. Anything not listed is
 * refused with 409 INVALID_TRANSITION.
 *
 *   draft ──submit──▶ pending_approval ──approve──▶ approved ⇄ suspended
 *                       ▲          │                (suspend / reinstate)
 *                       │        reject
 *                   resubmit       ▼
 *                       └────── rejected
 */
export const BUSINESS_TRANSITIONS: Record<
  BusinessStatus,
  readonly BusinessStatus[]
> = {
  draft: ['pending_approval'],
  pending_approval: ['approved', 'rejected'],
  rejected: ['pending_approval'],
  approved: ['suspended'],
  suspended: ['approved'],
};

export const canTransition = (
  from: BusinessStatus,
  to: BusinessStatus,
): boolean => BUSINESS_TRANSITIONS[from].includes(to);

export function invalidTransition(from: BusinessStatus, to: BusinessStatus) {
  return new ConflictException({
    code: ErrorCode.INVALID_TRANSITION,
    message: `A ${from.replace('_', ' ')} business cannot be moved to ${to.replace('_', ' ')}.`,
    details: { from, to },
  });
}

export function assertTransition(
  from: BusinessStatus,
  to: BusinessStatus,
): void {
  if (!canTransition(from, to)) throw invalidTransition(from, to);
}
