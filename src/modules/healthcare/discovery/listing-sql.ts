/**
 * The one definition of "a patient may see this doctor": the profile is
 * published and the business is approved (not pending, suspended or deleted).
 * Expects aliases d (doctors) and b (businesses).
 */
export const LISTED_DOCTOR_SQL = `d.is_listed AND b.status = 'approved'`;

export const DOCTOR_FROM_SQL = `
  FROM doctors d
  JOIN businesses b ON b.id = d.business_id`;
