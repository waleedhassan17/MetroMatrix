import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import { maskEmail } from '../../common/logging/mask-email';
import { emailTemplates } from './mail.templates';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * SMTP mailer (Brevo in production) with a console fallback.
 *
 * - When MAIL_HOST is set a nodemailer SMTP transport is created.
 * - When MAIL_HOST is empty — only possible outside production, env
 *   validation requires it there — every email is logged to the console,
 *   OTPs included, so the flows are fully testable locally.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transport: Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const host = this.config.get<string>('mail.host');
    if (!host) {
      if (this.config.get<string>('app.nodeEnv') !== 'production') {
        this.logger.warn(
          'MAIL_HOST is empty — emails will be logged to the console (dev transport).',
        );
      }
      return;
    }
    const user = this.config.get<string>('mail.user');
    this.transport = createTransport({
      host,
      port: this.config.get<number>('mail.port'),
      secure: this.config.get<boolean>('mail.secure'),
      ...(user
        ? { auth: { user, pass: this.config.get<string>('mail.pass') } }
        : {}),
    });
    this.logger.log(
      `SMTP transport ready (${host}:${this.config.get<number>('mail.port')})`,
    );
  }

  // ── Links ───────────────────────────────────────────────────────────────

  /** The app's deep-link scheme, e.g. `metromatrix`. */
  appScheme(): string {
    return this.config.get<string>('mail.appScheme', 'metromatrix');
  }

  /**
   * The two links a verification token travels in.
   *
   * - `webLink` (the button): the API's own page, GET /auth/verify, over
   *   APP_URL. It opens in any mail client on any device, spends the token
   *   and then offers the app without the token.
   * - `appLink`: opens the app directly on the phone it's installed on, which
   *   spends the token itself (POST /auth/verify-email).
   */
  buildVerificationLinks(token: string): { webLink: string; appLink: string } {
    const base = this.config
      .get<string>('app.appUrl', 'http://localhost:3000')
      .replace(/\/+$/, '');
    const prefix = this.config
      .get<string>('app.apiPrefix', 'api/v1')
      .replace(/^\/+|\/+$/g, '');
    const t = encodeURIComponent(token);
    return {
      webLink: `${base}/${prefix}/auth/verify?token=${t}`,
      appLink: `${this.appScheme()}://verify-email?token=${t}`,
    };
  }

  // ── High-level senders ──────────────────────────────────────────────────

  sendVerificationLink(to: string, name: string | null, token: string) {
    const { webLink, appLink } = this.buildVerificationLinks(token);
    const ttlHours = this.config.get<number>('mail.verifyTtlHours', 24);
    return this.send(
      to,
      emailTemplates.verifyEmail(name, webLink, appLink, ttlHours),
    );
  }

  sendPasswordResetOtp(to: string, name: string | null, otp: string) {
    const ttl = this.config.get<number>('mail.otpTtlMinutes', 10);
    return this.send(to, emailTemplates.resetPassword(name, otp, ttl));
  }

  /** `${APP_SCHEME}://`: the "Open MetroMatrix" button on business emails. */
  appHomeLink(): string {
    return `${this.appScheme()}://`;
  }

  /** SUPPORT_EMAIL, or null when it isn't configured. */
  supportEmail(): string | null {
    return this.config.get<string>('mail.supportEmail') || null;
  }

  sendBusinessApproved(
    to: string,
    name: string | null,
    businessName: string,
    opts: { reinstated?: boolean } = {},
  ) {
    return this.send(
      to,
      emailTemplates.businessApproved(
        name,
        businessName,
        opts.reinstated,
        this.appHomeLink(),
      ),
    );
  }

  sendBusinessRejected(
    to: string,
    name: string | null,
    businessName: string,
    reason: string,
    documentNotes: { label: string; note: string }[] = [],
  ) {
    return this.send(
      to,
      emailTemplates.businessRejected(
        name,
        businessName,
        reason,
        documentNotes,
        this.appHomeLink(),
      ),
    );
  }

  sendBusinessSuspended(
    to: string,
    name: string | null,
    businessName: string,
    reason: string,
  ) {
    return this.send(
      to,
      emailTemplates.businessSuspended(
        name,
        businessName,
        reason,
        this.supportEmail(),
      ),
    );
  }

  // ── Low-level send ──────────────────────────────────────────────────────

  /** Never throws: a mail failure must not break the flow that sent it. */
  async send(to: string, email: RenderedEmail): Promise<void> {
    const from = this.config.get<string>('mail.from');
    const production = this.config.get<string>('app.nodeEnv') === 'production';
    // Production logs never keep a recipient's address.
    const who = production ? maskEmail(to) : to;
    if (!this.transport) {
      if (production) {
        this.logger.error(`No SMTP transport — email to ${who} dropped.`);
        return;
      }
      // Dev/console transport — surface everything needed to test the flow.
      this.logger.log(
        `\n──────── [DEV EMAIL] ────────\nTo: ${to}\nFrom: ${from}\nSubject: ${email.subject}\n\n${email.text}\n─────────────────────────────`,
      );
      return;
    }
    try {
      await this.transport.sendMail({
        from,
        to,
        subject: email.subject,
        text: email.text,
        html: email.html,
      });
      this.logger.log(`Email sent to ${who}: "${email.subject}"`);
    } catch (err) {
      // SMTP errors often quote the address ("<a@b> rejected").
      const reason = (err as Error).message.split(to).join(who);
      this.logger.error(`Failed to send email to ${who}: ${reason}`);
    }
  }
}
