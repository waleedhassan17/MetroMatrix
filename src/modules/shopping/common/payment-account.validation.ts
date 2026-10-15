import { isPkMobile, normalizePkPhone } from '../../../common/validation/phone';

export const PAYMENT_ACCOUNT_KINDS = [
  'raast',
  'jazzcash',
  'easypaisa',
  'bank',
] as const;
export type PaymentAccountKind = (typeof PAYMENT_ACCOUNT_KINDS)[number];

/** PK + 2 check digits + 4-letter bank code + 16-digit account = 24 chars. */
const PK_IBAN = /^PK\d{2}[A-Z]{4}\d{16}$/;

/** ISO 13616 mod-97: valid IBANs leave remainder 1. */
export function ibanChecksumOk(iban: string): boolean {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, (ch) =>
    String(ch.charCodeAt(0) - 55),
  );
  let remainder = 0;
  for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97;
  return remainder === 1;
}

/**
 * Normalise and check an account number for its kind. Returns the canonical
 * form, or a reason it is not valid.
 *
 * - bank: a Pakistani IBAN (spaces allowed, any case) with a valid checksum.
 * - jazzcash / easypaisa: the mobile number the wallet is registered to.
 * - raast: a Raast ID, which is the account holder's mobile number.
 */
export function normalizeAccountNumber(
  kind: PaymentAccountKind,
  raw: string,
): { ok: true; value: string } | { ok: false; reason: string } {
  if (kind === 'bank') {
    const iban = raw.replace(/\s+/g, '').toUpperCase();
    if (!PK_IBAN.test(iban)) {
      return {
        ok: false,
        reason:
          'Enter a 24-character Pakistani IBAN (PK00 ABCD 0000 0000 0000 0000).',
      };
    }
    if (!ibanChecksumOk(iban)) {
      return {
        ok: false,
        reason: 'That IBAN has a typo — its check digits do not match.',
      };
    }
    return { ok: true, value: iban };
  }
  const phone = normalizePkPhone(raw);
  if (!phone || !isPkMobile(phone)) {
    const label =
      kind === 'raast'
        ? 'Raast ID'
        : kind === 'jazzcash'
          ? 'JazzCash'
          : 'Easypaisa';
    return {
      ok: false,
      reason: `Enter the ${label} mobile number (e.g. 0312 3456789).`,
    };
  }
  return { ok: true, value: phone };
}

/** For display without exposing the full number: `PK36 •••• 0123` / `+92312•••0176`. */
export function maskAccountNumber(
  kind: PaymentAccountKind,
  value: string,
): string {
  return kind === 'bank'
    ? `${value.slice(0, 4)} •••• ${value.slice(-4)}`
    : `${value.slice(0, 6)}•••${value.slice(-4)}`;
}

/** A valid PK IBAN for a bank code + 16-digit account (seed data, tests). */
export function buildPkIban(bankCode: string, account16: string): string {
  const body = `${bankCode}${account16}PK00`;
  const digits = body.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  let r = 0;
  for (const d of digits) r = (r * 10 + Number(d)) % 97;
  return `PK${String(98 - r).padStart(2, '0')}${bankCode}${account16}`;
}
