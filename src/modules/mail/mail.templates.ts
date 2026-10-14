/**
 * Plain, dependency-free email templates: inline HTML (mail clients ignore
 * stylesheets) plus a plain-text part for every message.
 *
 * Brand: the "MetroMatrix" wordmark as text, ink #16151A on paper #F7F5F1,
 * and exactly one button style. Every interpolated value goes through esc().
 */
import type { RenderedEmail } from './mail.service';

const INK = '#16151A';
const PAPER = '#F7F5F1';
const MUTED = '#6B6964';
const RULE = '#E4E0D8';
const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** HTML-escape anything a person typed (names, reasons, business names). */
export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:${PAPER};font-family:${FONT};color:${INK};">
    <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
      <div style="font-size:20px;font-weight:700;letter-spacing:-0.3px;color:${INK};padding-bottom:20px;border-bottom:1px solid ${RULE};">MetroMatrix</div>
      <h1 style="font-size:20px;line-height:1.3;margin:28px 0 12px;color:${INK};">${title}</h1>
      ${bodyHtml}
      <p style="margin:32px 0 0;padding-top:16px;border-top:1px solid ${RULE};font-size:12px;color:${MUTED};">
        This is an automated message from MetroMatrix. Please do not reply.
      </p>
    </div>
  </body>
</html>`;
}

function p(html: string): string {
  return `<p style="font-size:15px;line-height:1.6;margin:0 0 14px;color:${INK};">${html}</p>`;
}

/** The one button style. */
function button(href: string, label: string): string {
  return `<a href="${esc(href)}" style="display:inline-block;background:${INK};color:${PAPER};text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:15px;">${esc(label)}</a>`;
}

function codeBlock(code: string): string {
  return `<div style="font-size:32px;font-weight:700;letter-spacing:8px;font-family:'SFMono-Regular',Menlo,Consolas,monospace;color:${INK};background:#FFFFFF;border:1px solid ${RULE};border-radius:8px;padding:16px 0;text-align:center;margin:8px 0 18px;">${esc(code)}</div>`;
}

const hello = (name: string | null) => `Hi ${name ? esc(name) : 'there'},`;
const helloText = (name: string | null) => `Hi ${name ?? 'there'},`;

/** Opens the app on a phone that has it installed. */
const APP_LINK = 'metromatrix://';

export const emailTemplates = {
  verifyEmail(
    name: string | null,
    otp: string,
    ttlMinutes: number,
  ): RenderedEmail {
    return {
      subject: 'Verify your MetroMatrix email',
      html: layout(
        'Your verification code',
        p(hello(name)) +
          p(
            'Enter this code in the MetroMatrix app to confirm your email address:',
          ) +
          codeBlock(otp) +
          p(
            `The code expires in ${ttlMinutes} minutes. If you didn't create a MetroMatrix account, you can ignore this email.`,
          ),
      ),
      text:
        `${helloText(name)}\n\n` +
        `Your MetroMatrix verification code is: ${otp}\n\n` +
        `It expires in ${ttlMinutes} minutes. If you didn't create a MetroMatrix account, ignore this email.\n`,
    };
  },

  resetPassword(
    name: string | null,
    otp: string,
    ttlMinutes: number,
  ): RenderedEmail {
    return {
      subject: 'Your MetroMatrix password reset code',
      html: layout(
        'Reset your password',
        p(hello(name)) +
          p('Use this code to reset your MetroMatrix password:') +
          codeBlock(otp) +
          p(
            `The code expires in ${ttlMinutes} minutes. If you didn't ask to reset your password, ignore this email — your password stays the same.`,
          ),
      ),
      text:
        `${helloText(name)}\n\n` +
        `Your MetroMatrix password reset code is: ${otp}\n\n` +
        `It expires in ${ttlMinutes} minutes. If you didn't ask for this, ignore this email — your password stays the same.\n`,
    };
  },

  businessApproved(
    name: string | null,
    businessName: string,
    reinstated = false,
  ): RenderedEmail {
    const title = reinstated
      ? `${businessName} has been reinstated`
      : `${businessName} is approved`;
    const line = reinstated
      ? 'Your business is active on MetroMatrix again. Customers can find you and you can manage your listing as before.'
      : 'Your business has been approved and is now live on MetroMatrix. Open the app to finish setting up your listing.';
    return {
      subject: reinstated
        ? `${businessName} has been reinstated on MetroMatrix`
        : `${businessName} is approved on MetroMatrix`,
      html: layout(
        esc(title),
        p(hello(name)) +
          p(esc(line)) +
          `<p style="margin:22px 0;">${button(APP_LINK, 'Open MetroMatrix')}</p>`,
      ),
      text: `${helloText(name)}\n\n${line}\n`,
    };
  },

  businessRejected(
    name: string | null,
    businessName: string,
    reason: string,
    documentNotes: { label: string; note: string }[] = [],
  ): RenderedEmail {
    const notesHtml = documentNotes.length
      ? `<ul style="margin:0 0 14px;padding-left:20px;font-size:15px;line-height:1.6;color:${INK};">${documentNotes
          .map(
            (n) => `<li><strong>${esc(n.label)}:</strong> ${esc(n.note)}</li>`,
          )
          .join('')}</ul>`
      : '';
    const notesText = documentNotes.length
      ? `\n${documentNotes.map((n) => `- ${n.label}: ${n.note}`).join('\n')}\n`
      : '';
    return {
      subject: `Changes needed for ${businessName} on MetroMatrix`,
      html: layout(
        'Your application needs changes',
        p(hello(name)) +
          p(
            `We couldn't approve <strong>${esc(businessName)}</strong> yet. Here's why:`,
          ) +
          `<blockquote style="margin:0 0 14px;padding:12px 16px;border-left:3px solid ${INK};background:#FFFFFF;font-size:15px;line-height:1.6;">${esc(reason)}</blockquote>` +
          notesHtml +
          p(
            'Update your details or documents in the app and submit again — we review resubmissions quickly.',
          ),
      ),
      text:
        `${helloText(name)}\n\n` +
        `We couldn't approve ${businessName} yet. Reason:\n\n${reason}\n${notesText}\n` +
        `Update your details or documents in the app and submit again.\n`,
    };
  },

  businessSuspended(
    name: string | null,
    businessName: string,
    reason: string,
  ): RenderedEmail {
    return {
      subject: `${businessName} has been suspended on MetroMatrix`,
      html: layout(
        'Your business has been suspended',
        p(hello(name)) +
          p(
            `<strong>${esc(businessName)}</strong> is temporarily unavailable to customers. Reason:`,
          ) +
          `<blockquote style="margin:0 0 14px;padding:12px 16px;border-left:3px solid ${INK};background:#FFFFFF;font-size:15px;line-height:1.6;">${esc(reason)}</blockquote>` +
          p('If you think this is a mistake, contact MetroMatrix support.'),
      ),
      text:
        `${helloText(name)}\n\n` +
        `${businessName} is temporarily unavailable to customers. Reason:\n\n${reason}\n\n` +
        `If you think this is a mistake, contact MetroMatrix support.\n`,
    };
  },
};
