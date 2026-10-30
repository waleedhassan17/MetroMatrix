import { ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { GoogleAuthService } from './google-auth.service';
import { GoogleIdentity, GoogleTokenVerifier } from './google-token-verifier';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { OperationalAuditService } from '../../common/audit/operational-audit.service';

const client = { ip: '1.2.3.4', userAgent: 'jest' };

const identity = (over: Partial<GoogleIdentity> = {}): GoogleIdentity => ({
  sub: 'google-sub-1',
  email: 'ayesha@gmail.com',
  emailVerified: true,
  name: 'Ayesha Khan',
  picture: 'https://lh3.googleusercontent.com/a/photo',
  ...over,
});

const userRow = (over: Partial<User> = {}): User =>
  Object.assign(new User(), {
    id: 'u1',
    email: 'ayesha@gmail.com',
    passwordHash: 'hash',
    displayName: 'Ayesha',
    phone: null,
    role: 'customer',
    googleSub: null,
    avatarUrl: null,
    isEmailVerified: false,
    status: 'active',
    tokenVersion: 0,
    ...over,
  });

describe('GoogleAuthService', () => {
  let verifier: { verify: jest.Mock };
  let users: {
    findByGoogleSub: jest.Mock;
    findByEmail: jest.Mock;
    save: jest.Mock;
    createEntity: jest.Mock;
    getByIdOrFail: jest.Mock;
  };
  let auth: { completeSignin: jest.Mock; result: jest.Mock };
  let tokens: { startSession: jest.Mock; revokeAllForUser: jest.Mock };
  let audit: { record: jest.Mock };
  let manager: { update: jest.Mock };
  let svc: GoogleAuthService;

  beforeEach(() => {
    verifier = { verify: jest.fn(async () => identity()) };
    users = {
      findByGoogleSub: jest.fn(async () => null),
      findByEmail: jest.fn(async () => null),
      save: jest.fn(async (u: User) =>
        Object.assign(u, { id: u.id ?? 'new-id' }),
      ),
      createEntity: jest.fn((data: Partial<User>) =>
        Object.assign(new User(), data),
      ),
      getByIdOrFail: jest.fn(async (id: string) =>
        userRow({ id, passwordHash: null, isEmailVerified: true }),
      ),
    };
    auth = {
      completeSignin: jest.fn(async (u: User) => ({ user: u, kind: 'signin' })),
      result: jest.fn(async (u: User) => ({ user: u, kind: 'signup' })),
    };
    tokens = {
      startSession: jest.fn(async () => ({ accessToken: 'a' })),
      revokeAllForUser: jest.fn(async () => undefined),
    };
    audit = { record: jest.fn(async () => undefined) };
    manager = { update: jest.fn(async () => undefined) };
    const dataSource = {
      transaction: jest.fn(async (fn: (m: unknown) => Promise<unknown>) =>
        fn(manager),
      ),
    };
    svc = new GoogleAuthService(
      verifier as unknown as GoogleTokenVerifier,
      users as unknown as UsersService,
      auth as unknown as AuthService,
      tokens as unknown as TokenService,
      audit as unknown as OperationalAuditService,
      dataSource as unknown as DataSource,
    );
  });

  it('creates a new, verified customer for a Google account we have never seen', async () => {
    const res = (await svc.signIn('id-token', client)) as unknown as {
      user: User;
      kind: string;
    };
    expect(res.kind).toBe('signup');
    expect(users.createEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'ayesha@gmail.com',
        role: 'customer',
        isEmailVerified: true,
        googleSub: 'google-sub-1',
        passwordHash: null,
        displayName: 'Ayesha Khan',
      }),
    );
    expect(tokens.startSession).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.signup',
        details: { role: 'customer', method: 'google' },
      }),
    );
  });

  it('signs in the account already linked to this google_sub', async () => {
    const linked = userRow({
      googleSub: 'google-sub-1',
      isEmailVerified: true,
    });
    users.findByGoogleSub.mockResolvedValue(linked);
    const res = (await svc.signIn('id-token', client)) as unknown as {
      kind: string;
    };
    expect(res.kind).toBe('signin');
    expect(auth.completeSignin).toHaveBeenCalledWith(linked, client, {
      portal: 'customer',
      method: 'google',
    });
    expect(users.createEntity).not.toHaveBeenCalled();
  });

  it('links a verified customer by email and keeps their password and sessions', async () => {
    const existing = userRow({ isEmailVerified: true });
    users.findByEmail.mockResolvedValue(existing);
    await svc.signIn('id-token', client);
    expect(existing.googleSub).toBe('google-sub-1');
    expect(existing.passwordHash).toBe('hash');
    expect(existing.avatarUrl).toBe(
      'https://lh3.googleusercontent.com/a/photo',
    );
    expect(users.save).toHaveBeenCalledWith(existing);
    expect(tokens.revokeAllForUser).not.toHaveBeenCalled();
    expect(auth.completeSignin).toHaveBeenCalledWith(
      existing,
      client,
      expect.any(Object),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.google_linked',
        details: { tookOverUnverified: false },
      }),
    );
  });

  it('takes over an UNVERIFIED customer (pre-account hijack) in one transaction', async () => {
    users.findByEmail.mockResolvedValue(userRow({ phone: '+923001112233' }));
    await svc.signIn('id-token', client);
    expect(manager.update).toHaveBeenCalledWith(
      User,
      { id: 'u1' },
      expect.objectContaining({
        passwordHash: null,
        tokenVersion: expect.any(Function),
        googleSub: 'google-sub-1',
        isEmailVerified: true,
        displayName: 'Ayesha Khan',
        phone: null,
      }),
    );
    expect(tokens.revokeAllForUser).toHaveBeenCalledWith(
      'u1',
      undefined,
      manager,
    );
    expect(users.save).not.toHaveBeenCalled();
    // The session starts from the row as it is now.
    const signedIn = auth.completeSignin.mock.calls[0][0] as User;
    expect(signedIn.passwordHash).toBeNull();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ details: { tookOverUnverified: true } }),
    );
  });

  it("refuses a partner's email with WRONG_PORTAL and links nothing", async () => {
    const partner = userRow({ role: 'partner' });
    users.findByEmail.mockResolvedValue(partner);
    await expect(svc.signIn('id-token', client)).rejects.toMatchObject({
      response: {
        code: 'WRONG_PORTAL',
        details: { accountType: 'partner', portal: 'customer' },
      },
    });
    expect(partner.googleSub).toBeNull();
    expect(users.save).not.toHaveBeenCalled();
    expect(auth.completeSignin).not.toHaveBeenCalled();
  });

  it("refuses an admin's email the same way", async () => {
    users.findByEmail.mockResolvedValue(userRow({ role: 'super_admin' }));
    await expect(svc.signIn('id-token', client)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses a Google account whose email Google has not verified', async () => {
    verifier.verify.mockResolvedValue(identity({ emailVerified: false }));
    users.findByEmail.mockResolvedValue(userRow());
    await expect(svc.signIn('id-token', client)).rejects.toMatchObject({
      response: { code: 'EMAIL_NOT_VERIFIED' },
    });
    expect(users.findByEmail).not.toHaveBeenCalled();
    expect(users.createEntity).not.toHaveBeenCalled();
  });

  it('refuses a disabled customer', async () => {
    users.findByGoogleSub.mockResolvedValue(
      userRow({ googleSub: 'google-sub-1', status: 'disabled' }),
    );
    await expect(svc.signIn('id-token', client)).rejects.toMatchObject({
      response: { code: 'ACCOUNT_DISABLED' },
    });
  });
});

describe('GoogleTokenVerifier', () => {
  it('answers 503 SERVICE_UNAVAILABLE when no client ids are configured', async () => {
    const config = { get: () => [] } as unknown as ConstructorParameters<
      typeof GoogleTokenVerifier
    >[0];
    await expect(
      new GoogleTokenVerifier(config).verify('anything'),
    ).rejects.toMatchObject({
      status: 503,
      response: { code: 'SERVICE_UNAVAILABLE' },
    });
  });
});
