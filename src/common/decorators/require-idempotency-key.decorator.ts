import { SetMetadata } from '@nestjs/common';

export const REQUIRE_IDEMPOTENCY_KEY = 'requireIdempotencyKey';

/**
 * The route refuses to run without an `Idempotency-Key` header
 * (400 IDEMPOTENCY_KEY_REQUIRED). For writes that must never happen twice —
 * checkout above all. IdempotencyInterceptor enforces it and replays repeats.
 */
export const RequireIdempotencyKey = () =>
  SetMetadata(REQUIRE_IDEMPOTENCY_KEY, true);

export const SKIP_IDEMPOTENCY_KEY = 'skipIdempotency';

/**
 * Never store this route's response for replay: it carries a secret shown
 * once (a temporary password, recovery codes). An Idempotency-Key header is
 * ignored rather than letting the secret sit in idempotency_records.
 */
export const SkipIdempotency = () => SetMetadata(SKIP_IDEMPOTENCY_KEY, true);
