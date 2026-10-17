import { stateMachine } from '../../../common/state/transitions';

/**
 * A rider on an order: assigned → accepted_by_rider → arrived_at_branch →
 * picked_up → arrived_at_customer → delivered, or declined (back to the
 * vendor, unassigned). Each step is an order event of kind `rider`.
 * Accepting and "arrived" are courtesies: a rider may pick up straight away.
 */
export const RIDER_STEPS = [
  'assigned',
  'accepted_by_rider',
  'arrived_at_branch',
  'picked_up',
  'arrived_at_customer',
  'delivered',
  'declined',
] as const;
export type RiderStep = (typeof RIDER_STEPS)[number];

export const RIDER_STEP = stateMachine<RiderStep>({
  assigned: ['accepted_by_rider', 'picked_up', 'declined'],
  accepted_by_rider: ['arrived_at_branch', 'picked_up', 'declined'],
  arrived_at_branch: ['picked_up', 'declined'],
  picked_up: ['arrived_at_customer', 'delivered'],
  arrived_at_customer: ['delivered'],
  delivered: [],
  declined: [],
});
