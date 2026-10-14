import { applyDecorators } from '@nestjs/common';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** Same rule as FinMatrix: at least one lower-case, one upper-case, one digit. */
export const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/;

export const PASSWORD_RULE_MESSAGE =
  'Password must contain at least one lowercase letter, one uppercase letter, and one digit';

/**
 * The one password policy, applied everywhere a password is chosen (signup,
 * reset, change), so a password can never be created that could not be re-set
 * to itself.
 *
 * Max 72: bcrypt only reads the first 72 bytes, so anything longer would
 * silently match a shorter password.
 */
export function IsStrongPassword(): PropertyDecorator {
  return applyDecorators(
    IsString(),
    MinLength(8, { message: 'Password must be at least 8 characters' }),
    MaxLength(72, { message: 'Password must be at most 72 characters' }),
    Matches(PASSWORD_REGEX, { message: PASSWORD_RULE_MESSAGE }),
  );
}
