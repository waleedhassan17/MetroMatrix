// A date of birth: a real calendar date (YYYY-MM-DD), not in the future, and
// an age the app accepts. The mirror of the app's validatePersonalStep
// (MetroMatrix_App src/models/authModel.ts, MIN_AGE 13): keep the two in step
// so the form never submits what the server refuses.

import { registerDecorator, type ValidationOptions } from 'class-validator';

export const MIN_AGE = 13;
export const MAX_AGE = 120;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The UTC midnight of a YYYY-MM-DD string, or null if it isn't a real date. */
export function parseDateOnly(value: string): Date | null {
  const m = DATE_ONLY.exec(value);
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return date.getUTCFullYear() === Number(m[1]) &&
    date.getUTCMonth() === Number(m[2]) - 1 &&
    date.getUTCDate() === Number(m[3])
    ? date
    : null;
}

/** Whole years between a birth date and `today` (UTC). */
export function ageOn(birth: Date, today: Date): number {
  const age = today.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthday =
    today.getUTCMonth() < birth.getUTCMonth() ||
    (today.getUTCMonth() === birth.getUTCMonth() &&
      today.getUTCDate() < birth.getUTCDate());
  return beforeBirthday ? age - 1 : age;
}

export const BIRTH_DATE_MESSAGE = `Enter a real date of birth (YYYY-MM-DD), not in the future; you must be at least ${MIN_AGE}`;

export function IsBirthDate(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isBirthDate',
      target: target.constructor,
      propertyName: propertyName as string,
      options: { message: BIRTH_DATE_MESSAGE, ...validationOptions },
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string') return false;
          const birth = parseDateOnly(value);
          if (!birth) return false;
          const now = new Date();
          if (birth.getTime() > now.getTime()) return false;
          const age = ageOn(birth, now);
          return age >= MIN_AGE && age <= MAX_AGE;
        },
      },
    });
  };
}
