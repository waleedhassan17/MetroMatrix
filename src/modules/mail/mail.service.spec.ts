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

  it('logs the whole email — OTP included — when MAIL_HOST is empty outside production', async () => {
    const svc = mailService({ 'mail.host': '', 'app.nodeEnv': 'development' });
    await svc.sendVerificationOtp('a@example.com', 'Ali', '482913');
    expect(log.mock.calls.flat().join('\n')).toContain('482913');
  });

  it('never logs an OTP in production, even if the transport is missing', async () => {
    const svc = mailService({ 'mail.host': '', 'app.nodeEnv': 'production' });
    await svc.sendVerificationOtp('a@example.com', 'Ali', '482913');
    const everything = [...log.mock.calls, ...error.mock.calls]
      .flat()
      .join('\n');
    expect(everything).not.toContain('482913');
    expect(error).toHaveBeenCalled();
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
      emailTemplates.verifyEmail('A', '123456', 10),
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
});
