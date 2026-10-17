import { allowedFoodMoves, assertFoodTransition } from './food-order-status';
import { assertFoodPaymentTransition } from './food-payment-status';

describe('food order state machines', () => {
  it('the customer cancels only while placed', () => {
    expect(allowedFoodMoves('placed', 'customer', 'delivery')).toEqual([
      'cancelled',
    ]);
    expect(allowedFoodMoves('accepted', 'customer', 'delivery')).toEqual([]);
  });

  it('fulfilment decides what follows ready', () => {
    expect(allowedFoodMoves('ready', 'vendor', 'delivery')).toEqual([
      'on_the_way',
      'cancelled',
    ]);
    expect(allowedFoodMoves('ready', 'vendor', 'pickup')).toEqual([
      'picked_up',
      'cancelled',
    ]);
    expect(() =>
      assertFoodTransition('ready', 'picked_up', 'vendor', 'delivery'),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'INVALID_TRANSITION' }),
      }),
    );
  });

  it('only the system auto-rejects; a rider never accepts an order', () => {
    expect(() =>
      assertFoodTransition('placed', 'auto_rejected', 'vendor', 'delivery'),
    ).toThrow();
    expect(() =>
      assertFoodTransition('placed', 'auto_rejected', 'system', 'delivery'),
    ).not.toThrow();
    expect(() =>
      assertFoodTransition('placed', 'accepted', 'rider', 'delivery'),
    ).toThrow();
    expect(() =>
      assertFoodTransition('on_the_way', 'delivered', 'rider', 'delivery'),
    ).not.toThrow();
  });

  it('terminal states go nowhere', () => {
    for (const s of [
      'delivered',
      'picked_up',
      'rejected',
      'auto_rejected',
      'cancelled',
    ] as const)
      expect(allowedFoodMoves(s, 'admin', 'delivery')).toEqual([]);
  });

  it('payments: proof by the customer, confirm or reject by the vendor', () => {
    expect(() =>
      assertFoodPaymentTransition(
        'awaiting_transfer',
        'proof_submitted',
        'customer',
      ),
    ).not.toThrow();
    expect(() =>
      assertFoodPaymentTransition('proof_submitted', 'paid', 'customer'),
    ).toThrow();
    expect(() =>
      assertFoodPaymentTransition(
        'proof_submitted',
        'awaiting_transfer',
        'vendor',
      ),
    ).not.toThrow();
    expect(() =>
      assertFoodPaymentTransition('void', 'paid', 'vendor'),
    ).toThrow();
  });
});
