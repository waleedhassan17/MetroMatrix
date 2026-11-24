import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const verify = jest.fn();
const createTransport = jest.fn((_options: Record<string, unknown>) => ({
  verify,
  sendMail: jest.fn(),
}));
jest.mock('nodemailer', () => ({
  createTransport: (options: Record<string, unknown>) =>
    createTransport(options),
}));

import { MailService } from './mail.service';

function boot(values: Record<string, unknown>): MailService {
  const config = {
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
  } as unknown as ConfigService;
  const svc = new MailService(config);
  svc.onModuleInit();
  return svc;
}

const flush = () => new Promise((r) => setImmediate(r));

describe('MailService SMTP transport', () => {
  let log: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    createTransport.mockClear();
    verify.mockReset();
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const relay = {
    'mail.host': 'smtp-relay.brevo.com',
    'mail.port': 587,
    'mail.user': 'login',
    'mail.pass': 'key',
    'mail.connectionTimeoutMs': 10_000,
    'mail.greetingTimeoutMs': 10_000,
    'mail.socketTimeoutMs': 20_000,
    'app.nodeEnv': 'production',
  };

  it('bounds every SMTP phase, so a dead relay fails in seconds instead of minutes', () => {
    verify.mockResolvedValue(true);
    boot(relay);
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp-relay.brevo.com',
        port: 587,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      }),
    );
  });

  it('checks the relay once at boot, in the background, and logs the outcome', async () => {
    verify.mockResolvedValue(true);
    boot(relay);
    await flush();
    expect(verify).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.flat().join('\n')).toContain('SMTP reachable');

    verify.mockRejectedValue(new Error('Connection timeout'));
    boot(relay);
    await flush();
    expect(error.mock.calls.flat().join('\n')).toContain(
      'SMTP not reachable (smtp-relay.brevo.com:587): Connection timeout',
    );
  });

  it('does not dial the relay under test', () => {
    boot({ ...relay, 'app.nodeEnv': 'test' });
    expect(verify).not.toHaveBeenCalled();
  });
});
