import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';
import { emailTemplates, esc } from './mail.templates';

function mailService(values: Record<string, unknown>): MailService {
  const config = {
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
  } as unknown as ConfigService;
  const svc = new MailService(config);
  svc.onModuleInit();
  return svc;
}

describe('MailService console fallback', () => {
  let log: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('logs the whole email — link included — when MAIL_HOST is empty outside production', async () => {
    const svc = mailService({ 'mail.host': '', 'app.nodeEnv': 'development' });
    await svc.sendVerificationLink('a@example.com', 'Ali', 'TOKEN482913');
    expect(log.mock.calls.flat().join('\n')).toContain('TOKEN482913');
    await svc.sendPasswordResetOtp('a@example.com', 'Ali', '482913');
    expect(log.mock.calls.flat().join('\n')).toContain('482913');
  });

  it('never logs a link token or an OTP in production, even if the transport is missing', async () => {
    const svc = mailService({ 'mail.host': '', 'app.nodeEnv': 'production' });
    await svc.sendVerificationLink('a@example.com', 'Ali', 'TOKEN482913');
    await svc.sendPasswordResetOtp('a@example.com', 'Ali', '482913');
    const everything = [...log.mock.calls, ...error.mock.calls]
      .flat()
      .join('\n');
    expect(everything).not.toMatch(/TOKEN482913|482913/);
    expect(error).toHaveBeenCalled();
    expect(everything).not.toContain('a@example.com');
    expect(everything).toContain('a***@e***.com');
  });

  it('masks the recipient in production send and failure logs, SMTP error text included', async () => {
    const svc = mailService({ 'mail.host': '', 'app.nodeEnv': 'production' });
    const sendMail = jest
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(
        new Error('550 <ali.khan@example.com>: Recipient address rejected'),
      );
    (svc as unknown as { transport: unknown }).transport = { sendMail };
    await svc.sendPasswordResetOtp('ali.khan@example.com', 'Ali', '482913');
    await svc.sendPasswordResetOtp('ali.khan@example.com', 'Ali', '482913');
    const everything = [...log.mock.calls, ...error.mock.calls]
      .flat()
      .join('\n');
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(everything).not.toContain('ali.khan@example.com');
    expect(everything).toContain('Email sent to a***@e***.com');
    expect(everything).toContain(
      'Failed to send email to a***@e***.com: 550 <a***@e***.com>: Recipient address rejected',
    );
  });

  it('keeps the full address in development logs', async () => {
    const svc = mailService({ 'mail.host': '', 'app.nodeEnv': 'development' });
    const sendMail = jest.fn().mockResolvedValue({});
    (svc as unknown as { transport: unknown }).transport = { sendMail };
    await svc.sendPasswordResetOtp('ali.khan@example.com', 'Ali', '482913');
    expect(log.mock.calls.flat().join('\n')).toContain(
      'Email sent to ali.khan@example.com',
    );
  });
});

describe('MailService verification links', () => {
  it('web link on APP_URL + API_PREFIX, app link on APP_SCHEME, token URL-encoded', () => {
    const svc = mailService({
      'app.appUrl': 'https://api.metromatrix.pk/',
      'app.apiPrefix': '/api/v1/',
      'mail.appScheme': 'metromatrix',
    });
    expect(svc.buildVerificationLinks('a+b/c=')).toEqual({
      webLink:
        'https://api.metromatrix.pk/api/v1/auth/verify?token=a%2Bb%2Fc%3D',
      appLink: 'metromatrix://verify-email?token=a%2Bb%2Fc%3D',
    });
  });
});

describe('email templates', () => {
  it('escape everything a person typed', () => {
    expect(esc(`<b>"Tom" & 'Jerry'</b>`)).toBe(
      '&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;',
    );
    const rendered = emailTemplates.businessRejected(
      '<script>x</script>',
      'Shop <i>',
      'Bad <img src=x>',
      [{ label: 'CNIC (front)', note: '<blurry>' }],
    );
    expect(rendered.html).not.toMatch(/<script>|<img|<i>|<blurry>/);
    expect(rendered.text).toContain('Bad <img src=x>');
  });

  it('every template has a subject, HTML with the wordmark, and a text part', () => {
    const all = [
      emailTemplates.verifyEmail(
        'A',
        'https://x/api/v1/auth/verify?token=t',
        'metromatrix://verify-email?token=t',
        24,
      ),
      emailTemplates.resetPassword(null, '123456', 10),
      emailTemplates.businessApproved('A', 'Shop'),
      emailTemplates.businessApproved('A', 'Shop', true),
      emailTemplates.businessRejected('A', 'Shop', 'Reason'),
      emailTemplates.businessSuspended('A', 'Shop', 'Reason'),
    ];
    for (const e of all) {
      expect(e.subject.length).toBeGreaterThan(5);
      expect(e.html).toContain('MetroMatrix');
      expect(e.html).toContain('#16151A');
      expect(e.text.length).toBeGreaterThan(20);
    }
  });

  it('the verification email: button to the web page, app link, copyable link, TTL from config', () => {
    const web = 'https://x/api/v1/auth/verify?token=t&a=<b>';
    const e = emailTemplates.verifyEmail(
      'Ali',
      web,
      'metromatrix://verify-email?token=t',
      1,
    );
    expect(e.html).toContain('Verify email');
    expect(e.html).toContain('Open in the app');
    expect(e.html).toContain('1 hour.');
    expect(e.html).not.toContain('<b>');
    expect(e.text).toContain(web);
    expect(e.text).toContain('metromatrix://verify-email?token=t');
    expect(emailTemplates.verifyEmail(null, web, 'm://', 48).text).toContain(
      '48 hours',
    );
  });
});

describe('business emails', () => {
  let send: jest.SpyInstance;
  afterEach(() => jest.restoreAllMocks());

  const sentWith = (values: Record<string, unknown>) => {
    const svc = mailService({ 'mail.host': '', ...values });
    send = jest.spyOn(svc, 'send').mockResolvedValue(undefined);
    return svc;
  };
  const rendered = () =>
    send.mock.calls[0][1] as { html: string; text: string };

  it('the rejected email has an "Open MetroMatrix" button on APP_SCHEME', async () => {
    const svc = sentWith({ 'mail.appScheme': 'metromatrix-dev' });
    await svc.sendBusinessRejected('a@x.com', 'Ali', 'Shop', 'Blurry CNIC');
    expect(rendered().html).toContain('href="metromatrix-dev://"');
    expect(rendered().html).toContain('Open MetroMatrix');
    expect(rendered().text).toContain('metromatrix-dev://');
  });

  it('the approved email uses APP_SCHEME too, not a fixed scheme', async () => {
    const svc = sentWith({ 'mail.appScheme': 'metromatrix-dev' });
    await svc.sendBusinessApproved('a@x.com', 'Ali', 'Shop');
    expect(rendered().html).toContain('href="metromatrix-dev://"');
    expect(rendered().html).not.toContain('href="metromatrix://"');
  });

  it('the suspended email names SUPPORT_EMAIL when set, and stays generic otherwise', async () => {
    const svc = sentWith({ 'mail.supportEmail': 'help@metromatrix.pk' });
    await svc.sendBusinessSuspended('a@x.com', 'Ali', 'Shop', 'Complaints');
    expect(rendered().html).toContain('href="mailto:help@metromatrix.pk"');
    expect(rendered().text).toContain(
      'contact MetroMatrix support at help@metromatrix.pk.',
    );

    const plain = sentWith({ 'mail.supportEmail': '' });
    await plain.sendBusinessSuspended('a@x.com', 'Ali', 'Shop', 'Complaints');
    expect(rendered().text).toContain('contact MetroMatrix support.');
    expect(rendered().html).not.toContain('mailto:');
  });
});
