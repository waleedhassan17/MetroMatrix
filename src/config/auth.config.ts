import { registerAs } from '@nestjs/config';

export default registerAs('auth', () => ({
  /** Mixed into every OTP / reset-code / recovery-code hash at rest. */
  otpPepper: process.env.OTP_PEPPER ?? '',
  /** 32 bytes, base64. AES-256-GCM key for admin TOTP secrets. */
  totpEncKey: process.env.TOTP_ENC_KEY ?? '',
  /** How long the token from /auth/verify-otp may be spent on a reset. */
  resetTokenTtlMinutes: 15,
}));
