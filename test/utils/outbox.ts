import { Injectable } from '@nestjs/common';
import {
  MailService,
  RenderedEmail,
} from '../../src/modules/mail/mail.service';

export interface SentEmail extends RenderedEmail {
  to: string;
}

/** Every email the app "sends" during the e2e run, newest last. */
export const outbox: SentEmail[] = [];

/** MailService with send() captured instead of delivered. */
@Injectable()
export class CapturingMailService extends MailService {
  async send(to: string, email: RenderedEmail): Promise<void> {
    outbox.push({ to, ...email });
  }
}

export function lastEmailTo(to: string): SentEmail | undefined {
  for (let i = outbox.length - 1; i >= 0; i--) {
    if (outbox[i].to.toLowerCase() === to.toLowerCase()) return outbox[i];
  }
  return undefined;
}

export function emailsTo(to: string): SentEmail[] {
  return outbox.filter((e) => e.to.toLowerCase() === to.toLowerCase());
}

/** The 6-digit code in the most recent email to `to`. */
export function lastOtpFor(to: string): string {
  const email = lastEmailTo(to);
  const code = email?.text.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error(`No OTP email found for ${to}`);
  return code;
}
