import { generateKeyPairSync } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import {
  JaasProvider,
  MAX_TOKEN_MS,
  PublicJitsiProvider,
} from './video-provider';

describe('video providers', () => {
  const room = '0f6b9c1e-2d3a-4b5c-8d7e-9f0a1b2c3d4e';
  const now = new Date('2026-10-16T10:00:00Z');
  const doctor = {
    id: 'u-doc',
    name: 'Dr. Sana Iqbal',
    moderator: true,
    avatar: 'https://x/a.png',
  };
  const patient = { id: 'u-pat', name: 'Ali Raza', moderator: false };

  it('public Jitsi: an unguessable room, no token', () => {
    const j = new PublicJitsiProvider().join(room, patient);
    expect(j).toMatchObject({
      provider: 'public_jitsi',
      domain: 'meet.jit.si',
      roomName: `mm-${room}`,
      jwt: null,
    });
    expect(j.roomUrl).toBe(
      `https://meet.jit.si/mm-${room}#userInfo.displayName=%22Ali%20Raza%22`,
    );
  });

  describe('JaaS', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const appId = 'vpaas-magic-cookie-1fc542a3e4414a44b2611668195e2bfe';
    const jaas = new JaasProvider({
      appId,
      kid: `${appId}/4f4910`,
      privateKey,
    });
    const verify = (token: string) =>
      new JwtService().verify(token, {
        publicKey,
        algorithms: ['RS256'],
        audience: 'jitsi',
        issuer: 'chat',
        clockTimestamp: Math.floor(now.getTime() / 1000),
      });

    it('signs RS256 with the key id and the claims JaaS expects', () => {
      const until = new Date(now.getTime() + 45 * 60_000);
      const j = jaas.join(room, doctor, until, now);
      const header = JSON.parse(
        Buffer.from(j.jwt!.split('.')[0], 'base64url').toString(),
      );
      expect(header).toMatchObject({ alg: 'RS256', kid: `${appId}/4f4910` });
      const claims = verify(j.jwt!);
      expect(claims).toMatchObject({
        aud: 'jitsi',
        iss: 'chat',
        sub: appId,
        room: `mm-${room}`,
        exp: Math.floor(until.getTime() / 1000),
        context: {
          user: { id: 'u-doc', name: 'Dr. Sana Iqbal', moderator: 'true' },
          features: { recording: 'false', livestreaming: 'false' },
        },
      });
      expect(j).toMatchObject({
        provider: 'jaas',
        domain: '8x8.vc',
        roomName: `${appId}/mm-${room}`,
        moderator: true,
        expiresAt: until.toISOString(),
      });
      expect(j.roomUrl).toBe(`https://8x8.vc/${appId}/mm-${room}?jwt=${j.jwt}`);
    });

    it('patients are not moderators; tokens never outlive two hours', () => {
      const j = jaas.join(
        room,
        patient,
        new Date(now.getTime() + 6 * 3600e3),
        now,
      );
      const claims = verify(j.jwt!);
      expect(claims.context.user.moderator).toBe('false');
      expect(claims.exp * 1000).toBe(now.getTime() + MAX_TOKEN_MS);
    });

    it('refuses a mismatched key id or a non-PEM key', () => {
      expect(
        () => new JaasProvider({ appId, kid: 'other/1', privateKey }),
      ).toThrow(/JAAS_KID/);
      expect(
        () => new JaasProvider({ appId, kid: `${appId}/1`, privateKey: 'x' }),
      ).toThrow(/JAAS_PRIVATE_KEY/);
    });
  });
});
