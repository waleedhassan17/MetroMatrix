import { BadRequestException, ValidationError } from '@nestjs/common';
import { ErrorCode } from '../errors/codes';

/**
 * `{ "password": ["Password must be at least 8 characters"], "address.city": [...] }`
 * — one entry per offending field, nested DTOs dotted.
 */
export function flattenValidationErrors(
  errors: ValidationError[],
  parent = '',
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const err of errors) {
    const path = parent ? `${parent}.${err.property}` : err.property;
    if (err.constraints) {
      out[path] = Object.values(err.constraints);
    }
    if (err.children?.length) {
      Object.assign(out, flattenValidationErrors(err.children, path));
    }
  }
  return out;
}

/**
 * Used by the global ValidationPipe. The client gets the first problem as a
 * readable message and every problem, per field, under `details.fields`.
 */
export function validationExceptionFactory(
  errors: ValidationError[],
): BadRequestException {
  const fields = flattenValidationErrors(errors);
  const first = Object.values(fields)[0]?.[0];
  return new BadRequestException({
    code: ErrorCode.VALIDATION_FAILED,
    message: first ?? 'Validation failed',
    details: { fields },
  });
}
