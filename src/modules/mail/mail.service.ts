import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
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

  // ── High-level senders ──────────────────────────────────────────────────

  sendVerificationOtp(to: string, name: string | null, otp: string) {
    const ttl = this.config.get<number>('mail.otpTtlMinutes', 10);
    return this.send(to, emailTemplates.verifyEmail(name, otp, ttl));
  }

  sendPasswordResetOtp(to: string, name: string | null, otp: string) {
    const ttl = this.config.get<number>('mail.otpTtlMinutes', 10);
    return this.send(to, emailTemplates.resetPassword(name, otp, ttl));
  }

  sendBusinessApproved(
    to: string,
    name: string | null,
    businessName: string,
    opts: { reinstated?: boolean } = {},
  ) {
    return this.send(
      to,
      emailTemplates.businessApproved(name, businessName, opts.reinstated),
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
      emailTemplates.businessSuspended(name, businessName, reason),
    );
  }

  // ── Low-level send ──────────────────────────────────────────────────────

  /** Never throws: a mail failure must not break the flow that sent it. */
  async send(to: string, email: RenderedEmail): Promise<void> {
    const from = this.config.get<string>('mail.from');
    if (!this.transport) {
      if (this.config.get<string>('app.nodeEnv') === 'production') {
        this.logger.error(`No SMTP transport — email to ${to} dropped.`);
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
      this.logger.log(`Email sent to ${to}: "${email.subject}"`);
    } catch (err) {
      this.logger.error(
        `Failed to send email to ${to}: ${(err as Error).message}`,
      );
    }
  }
}
