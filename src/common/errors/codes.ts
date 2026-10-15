/**
 * Every `error.code` the API can return. Clients branch on these, never on
 * HTTP status or message text, so a code is a contract: add freely, never
 * rename or reuse one for a different meaning.
 *
 * Throw them the FinMatrix way — a built-in Nest exception carrying
 * `{ code, message, details? }` — and AllExceptionsFilter puts them in the
 * error envelope. Only those three keys survive the filter.
 */
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  EMAIL_EXISTS: 'EMAIL_EXISTS',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  WRONG_PORTAL: 'WRONG_PORTAL',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  OTP_INVALID: 'OTP_INVALID',
  OTP_EXPIRED: 'OTP_EXPIRED',
  OTP_LOCKED: 'OTP_LOCKED',
  RESEND_COOLDOWN: 'RESEND_COOLDOWN',
  REFRESH_INVALID: 'REFRESH_INVALID',
  REFRESH_REUSED: 'REFRESH_REUSED',
  TOKEN_REVOKED: 'TOKEN_REVOKED',
  TOTP_REQUIRED: 'TOTP_REQUIRED',
  TOTP_INVALID: 'TOTP_INVALID',
  BUSINESS_EXISTS: 'BUSINESS_EXISTS',
  BUSINESS_NOT_EDITABLE: 'BUSINESS_NOT_EDITABLE',
  DOCUMENTS_MISSING: 'DOCUMENTS_MISSING',
  BUSINESS_NOT_APPROVED: 'BUSINESS_NOT_APPROVED',
  BUSINESS_SUSPENDED: 'BUSINESS_SUSPENDED',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',

  // Beyond the Chunk 1 list:
  /** Missing, malformed or expired bearer token. */
  UNAUTHORIZED: 'UNAUTHORIZED',
  /** Generic 409 when nothing more specific applies. */
  CONFLICT: 'CONFLICT',
  /** A dependency (database, Google, Cloudinary) is down or not configured. */
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  /** A POST with this Idempotency-Key is still being processed. */
  IDEMPOTENCY_IN_PROGRESS: 'IDEMPOTENCY_IN_PROGRESS',

  // ── Chunk 2: Shopping ─────────────────────────────────────────────────────
  /** A partner of another service (food, healthcare) on a shopping route. */
  WRONG_SERVICE: 'WRONG_SERVICE',
  STORE_UNAVAILABLE: 'STORE_UNAVAILABLE',
  DELIVERY_UNAVAILABLE: 'DELIVERY_UNAVAILABLE',
  CART_EMPTY: 'CART_EMPTY',
  /** The stores in the checkout body don't match the stores in the cart. */
  CHECKOUT_MISMATCH: 'CHECKOUT_MISMATCH',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  PRICE_CHANGED: 'PRICE_CHANGED',
  COUPON_INVALID: 'COUPON_INVALID',
  COUPON_EXPIRED: 'COUPON_EXPIRED',
  COUPON_MIN_ORDER: 'COUPON_MIN_ORDER',
  COUPON_LIMIT_REACHED: 'COUPON_LIMIT_REACHED',
  COD_LIMIT_EXCEEDED: 'COD_LIMIT_EXCEEDED',
  PAYMENT_METHOD_UNAVAILABLE: 'PAYMENT_METHOD_UNAVAILABLE',
  PAYMENT_NOT_CONFIRMED: 'PAYMENT_NOT_CONFIRMED',
  RETURN_WINDOW_CLOSED: 'RETURN_WINDOW_CLOSED',
  RETURN_ALREADY_OPEN: 'RETURN_ALREADY_OPEN',
  REVIEW_NOT_ALLOWED: 'REVIEW_NOT_ALLOWED',
  REVIEW_EXISTS: 'REVIEW_EXISTS',
  /** Checkout must carry an Idempotency-Key header. */
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
