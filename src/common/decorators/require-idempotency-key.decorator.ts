import { SetMetadata } from '@nestjs/common';

export const REQUIRE_IDEMPOTENCY_KEY = 'requireIdempotencyKey';

/**
 * The route refuses to run without an `Idempotency-Key` header
 * (400 IDEMPOTENCY_KEY_REQUIRED). For writes that must never happen twice —
 * checkout above all. IdempotencyInterceptor enforces it and replays repeats.
 */
export const RequireIdempotencyKey = () =>
  SetMetadata(REQUIRE_IDEMPOTENCY_KEY, true);
