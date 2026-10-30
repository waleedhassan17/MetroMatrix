import { BadRequestException, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailVerificationService } from './email-verification.service';
import { sha256Hex } from '../../common/crypto/hash';

/**
 * The link rules without a database: what is stored, which links verify,
 * which fail, and the resend cooldown. (test/email-verification.e2e-spec.ts
 * covers the same flow through HTTP and Postgres.)
 */
describe('EmailVerificationService', () => {
  const HOUR = 3_600_000;
  const config = {
    get: (key: string, fallback?: unknown) =>
      (
        ({
          'mail.verifyTtlHours': 24,
          'mail.resendCooldownSeconds': 60,
        }) as Record<string, unknown>
      )[key] ?? fallback,
  } as unknown as ConfigService;

  type Row = {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    usedAt: Date | null;
    createdAt: Date;
  };

  const setup = (verified = false) => {
    const rows: Row[] = [];
    const user = {
      id: 'u1',
      email: 'a@x.pk',
      displayName: 'A',
      isEmailVerified: verified,
    };
    const repo = {
      update: jest.fn(async (where: Partial<Row>, set: Partial<Row>) => {
        rows
          .filter((r) => r.userId === where.userId && r.usedAt === null)
          .forEach((r) => Object.assign(r, set));
      }),
      create: (r: Partial<Row>) => r,
      insert: jest.fn(async (r: Row) => {
        rows.push({ ...r, id: `t${rows.length + 1}`, createdAt: new Date() });
      }),
      findOne: jest.fn(
        async ({ where, order }: { where: Partial<Row>; order?: unknown }) => {
          const match = rows.filter((r) =>
            where.tokenHash
              ? r.tokenHash === where.tokenHash
              : r.userId === where.userId,
          );
          return (
            (order
              ? match.sort(
                  (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
                )
              : match)[0] ?? null
          );
        },
      ),
    };
    const users = { findById: jest.fn(async () => user) };
    const mail = {
      sendVerificationLink: jest.fn(async () => undefined),
      appScheme: () => 'metromatrix',
    };
    const audit = { record: jest.fn(async () => undefined) };
    // The transaction: a conditional spend, then the owner's flag.
    const dataSource = {
      transaction: jest.fn(async (fn: (m: unknown) => Promise<boolean>) =>
        fn({
          createQueryBuilder: () => ({
            update: () => ({
              set: () => ({
                where: (_q: string, { id }: { id: string }) => ({
                  execute: async () => {
                    const row = rows.find(
                      (r) => r.id === id && r.usedAt === null,
                    );
                    if (row) row.usedAt = new Date();
                    return { affected: row ? 1 : 0 };
                  },
                }),
              }),
            }),
          }),
          update: async () => {
            user.isEmailVerified = true;
          },
        }),
      ),
    };
    const svc = new EmailVerificationService(
      repo as never,
      users as never,
      mail as never,
      audit as never,
      dataSource as never,
      config,
    );
    const sentToken = () =>
      (mail.sendVerificationLink.mock.calls.at(-1) as unknown[])[2] as string;
    return { svc, rows, user, mail, audit, sentToken };
  };

  it('issue stores only the SHA-256 of a 32-byte token, valid for 24 h, and emails the token', async () => {
    const { svc, rows, sentToken } = setup();
    await svc.issue({ id: 'u1', email: 'a@x.pk', displayName: 'A' } as never);
    const token = sentToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(rows[0].tokenHash).toBe(sha256Hex(token));
    expect(rows[0].tokenHash).not.toContain(token);
    expect(rows[0].expiresAt.getTime() - Date.now()).toBeGreaterThan(
      23.9 * HOUR,
    );
  });

  it('a new link retires the outstanding one', async () => {
    const { svc, rows } = setup();
    await svc.issue({ id: 'u1' } as never);
    await svc.issue({ id: 'u1' } as never);
    expect(rows.map((r) => r.usedAt === null)).toEqual([false, true]);
  });

  it('verify spends the link, verifies the owner and audits once', async () => {
    const { svc, user, audit, sentToken } = setup();
    await svc.issue(user as never);
    const out = await svc.verify(sentToken());
    expect(out.alreadyVerified).toBe(false);
    expect(user.isEmailVerified).toBe(true);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.email_verified' }),
    );
  });

  it('a spent or expired link succeeds when the owner is verified, fails when not', async () => {
    const { svc, rows, user, sentToken } = setup();
    await svc.issue(user as never);
    const token = sentToken();
    rows[0].expiresAt = new Date(Date.now() - 1000);
    await expect(svc.verify(token)).rejects.toBeInstanceOf(BadRequestException);
    user.isEmailVerified = true;
    await expect(svc.verify(token)).resolves.toMatchObject({
      alreadyVerified: true,
    });
  });

  it('an unknown or empty token is VERIFY_LINK_INVALID', async () => {
    const { svc } = setup();
    for (const t of ['nope', '']) {
      const err = await svc.verify(t).catch((e: HttpException) => e);
      expect((err as HttpException).getResponse()).toMatchObject({
        code: 'VERIFY_LINK_INVALID',
      });
    }
  });

  it('resend: cooldown from the latest link, then a fresh one; nothing for a verified owner', async () => {
    const { svc, rows, user } = setup();
    await svc.issue(user as never);
    const err = await svc.resend(user as never).catch((e: HttpException) => e);
    expect((err as HttpException).getStatus()).toBe(429);
    expect((err as HttpException).getResponse()).toMatchObject({
      code: 'RESEND_COOLDOWN',
      details: { retryAfter: expect.any(Number) },
    });
    rows[0].createdAt = new Date(Date.now() - 61_000);
    await expect(svc.resend(user as never)).resolves.toEqual({
      sent: true,
      alreadyVerified: false,
      retryAfter: 60,
    });
    user.isEmailVerified = true;
    await expect(svc.resend(user as never)).resolves.toEqual({
      sent: false,
      alreadyVerified: true,
      retryAfter: 0,
    });
  });

  it('the onward link for the web page never carries a token', () => {
    expect(setup().svc.onwardLinks()).toEqual({
      app: 'metromatrix://verify-email?verified=1',
    });
  });
});
