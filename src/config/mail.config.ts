import { registerAs } from '@nestjs/config';

/**
 * SMTP (Brevo in production) + OTP tuning.
 *
 * When MAIL_HOST is empty the MailService logs every email — OTPs included —
 * to the console so the flows are testable locally. That fallback exists only
 * outside production: env validation requires MAIL_* there.
 */
export default registerAs('mail', () => {
  const port = parseInt(process.env.MAIL_PORT ?? '587', 10);
  return {
    host: process.env.MAIL_HOST ?? '',
    port,
    // 465 is implicit TLS; 587/2525 (Brevo) upgrade with STARTTLS.
    secure: port === 465,
    user: process.env.MAIL_USER ?? '',
    pass: process.env.MAIL_PASS ?? '',
    from: process.env.MAIL_FROM || 'MetroMatrix <no-reply@metromatrix.pk>',

    otpTtlMinutes: 10,
    otpMaxAttempts: 5,
    resendCooldownSeconds: 60,
  };
});
