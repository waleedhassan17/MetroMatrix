import { ConflictException } from '@nestjs/common';
import {
  ORDER_STATUSES,
  allowedOrderMoves,
  assertOrderTransition,
} from './order-status';
import {
  PAYMENT_ON_CANCEL,
  PAYMENT_STATUSES,
  allowedPaymentMoves,
  assertPaymentTransition,
} from './payment-status';

describe('shopping state machines', () => {
  it('customers cancel only before confirmation; the system alone completes', () => {
    expect(allowedOrderMoves('placed', 'customer')).toEqual(['cancelled']);
    expect(allowedOrderMoves('confirmed', 'customer')).toEqual([]);
    expect(allowedOrderMoves('shipped', 'customer')).toEqual(['delivered']);
    expect(allowedOrderMoves('delivered', 'store')).toEqual([]);
    expect(allowedOrderMoves('delivered', 'system')).toEqual(['completed']);
    for (const terminal of ['completed', 'cancelled'] as const) {
      for (const actor of ['customer', 'store', 'system', 'admin'] as const) {
        expect(allowedOrderMoves(terminal, actor)).toEqual([]);
      }
    }
  });

  it('an illegal move throws 409 INVALID_TRANSITION with from, to and what is allowed', () => {
    try {
      assertOrderTransition('placed', 'shipped', 'store');
      fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ConflictException);
      expect((e as ConflictException).getResponse()).toMatchObject({
        code: 'INVALID_TRANSITION',
        details: {
          from: 'placed',
          to: 'shipped',
          allowed: ['confirmed', 'cancelled'],
        },
      });
    }
    expect(() =>
      assertPaymentTransition('awaiting_transfer', 'proof_submitted', 'store'),
    ).toThrow(ConflictException);
    expect(() =>
      assertPaymentTransition(
        'awaiting_transfer',
        'proof_submitted',
        'customer',
      ),
    ).not.toThrow();
  });

  it('every state is reachable from the start and every cancel outcome is a legal move', () => {
    const reach = (start: string, next: (s: any) => string[]) => {
      const seen = new Set([start]);
      const queue = [start];
      while (queue.length) {
        for (const n of next(queue.shift()!)) {
          if (seen.has(n)) continue;
          seen.add(n);
          queue.push(n);
        }
      }
      return seen;
    };
    const all = (s: any) =>
      (['customer', 'store', 'system', 'admin'] as const).flatMap((a) =>
        allowedOrderMoves(s, a),
      );
    expect([...reach('placed', all)].sort()).toEqual(
      [...ORDER_STATUSES].sort(),
    );
    const pay = (s: any) =>
      (['customer', 'store', 'system', 'admin'] as const).flatMap((a) =>
        allowedPaymentMoves(s, a),
      );
    const fromCod = reach('cod_pending', pay);
    const fromTransfer = reach('awaiting_transfer', pay);
    expect(new Set([...fromCod, ...fromTransfer])).toEqual(
      new Set(PAYMENT_STATUSES),
    );
    for (const [from, to] of Object.entries(PAYMENT_ON_CANCEL)) {
      expect(() =>
        assertPaymentTransition(from as any, to, 'system'),
      ).not.toThrow();
    }
  });
});
