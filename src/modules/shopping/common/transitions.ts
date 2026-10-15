import { ConflictException } from '@nestjs/common';
import { ErrorCode } from '../../../common/errors/codes';

/** 409 INVALID_TRANSITION with `{ from, to, allowed }` in details. */
export function invalidTransition(
  from: string,
  to: string,
  allowed: readonly string[],
  message?: string,
) {
  return new ConflictException({
    code: ErrorCode.INVALID_TRANSITION,
    message:
      message ??
      `Cannot move from ${from.replace(/_/g, ' ')} to ${to.replace(/_/g, ' ')}.`,
    details: { from, to, allowed },
  });
}

/**
 * A state machine as data: `map[from]` lists the states `from` may move to.
 * Order, payment and return statuses each export one, so every legal move is
 * written down in exactly one place.
 */
export function stateMachine<S extends string>(map: Record<S, readonly S[]>) {
  return {
    map,
    allowed: (from: S): readonly S[] => map[from] ?? [],
    can: (from: S, to: S): boolean => (map[from] ?? []).includes(to),
    assert(from: S, to: S, message?: string): void {
      if (!(map[from] ?? []).includes(to)) {
        throw invalidTransition(from, to, map[from] ?? [], message);
      }
    },
  };
}
