/**
 * A search as it is kept for the demand map: lower case, letters and digits
 * only (Urdu script too), single spaces, at most 60 characters — and no run
 * of 4+ digits or anything shaped like an email address, so a phone number
 * or an address typed into the search box is never stored.
 * Under 2 characters left → null.
 */
export function normalizeQuery(q: string | null | undefined): string | null {
  if (!q) return null;
  const s = q
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\S+@\S+/g, ' ')
    .replace(/\p{Nd}{4,}/gu, ' ')
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim();
  return s.length >= 2 ? s : null;
}
