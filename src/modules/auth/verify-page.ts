/**
 * The page GET /auth/verify answers: the email's "Verify email" button opens
 * it in whatever browser the mail client uses. A plain, script-free document
 * (served under a CSP that allows nothing but inline styles), in the email
 * templates' brand.
 *
 * The onward button never carries the token: this request has just spent it,
 * so the app is told only that the address is verified
 * (metromatrix://verify-email?verified=1) and re-reads the account.
 */
import { esc, FONT, INK, MUTED, PAPER, RULE } from '../mail/mail.templates';

export type VerifyPageOutcome = 'verified' | 'already' | 'invalid';

/** The response headers for the page: nothing may load, frame or leak it. */
export const VERIFY_PAGE_HEADERS = {
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
} as const;

export function renderVerifyPage(
  outcome: VerifyPageOutcome,
  appLink: string,
): string {
  const ok = outcome !== 'invalid';
  const title = ok ? 'Email verified' : "This link didn't work";
  const body = ok
    ? outcome === 'already'
      ? 'Your email address was already verified. You can carry on in the MetroMatrix app.'
      : 'Thanks, your email address is confirmed. Go back to the MetroMatrix app to carry on.'
    : 'This link has expired or been replaced. Open the app and tap Resend.';
  const action = ok
    ? `<p style="margin:24px 0 0;"><a href="${esc(appLink)}" style="display:inline-block;background:${INK};color:${PAPER};text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:15px;">Open the MetroMatrix app</a></p>`
    : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="referrer" content="no-referrer">
    <title>${esc(title)} · MetroMatrix</title>
  </head>
  <body style="margin:0;padding:0;background:${PAPER};font-family:${FONT};color:${INK};">
    <main style="max-width:480px;margin:0 auto;padding:48px 24px;">
      <div style="font-size:20px;font-weight:700;letter-spacing:-0.3px;padding-bottom:20px;border-bottom:1px solid ${RULE};">MetroMatrix</div>
      <h1 style="font-size:22px;line-height:1.3;margin:28px 0 12px;">${esc(title)}</h1>
      <p style="font-size:15px;line-height:1.6;margin:0;color:${ok ? INK : MUTED};">${esc(body)}</p>
      ${action}
    </main>
  </body>
</html>`;
}
