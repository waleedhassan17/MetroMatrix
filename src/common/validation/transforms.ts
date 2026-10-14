import { Transform } from 'class-transformer';

/** Trim surrounding whitespace from a string field; leave other types alone. */
export const Trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

/** Trim and lower-case — for email addresses. */
export const NormalizeEmail = () =>
  Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );
