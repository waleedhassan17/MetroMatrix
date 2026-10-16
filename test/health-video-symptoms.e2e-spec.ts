import { generateKeyPairSync, randomUUID } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { ApiClient, createTestApp, TestApp } from './utils/test-app';
import { enrolledAdmin } from './utils/admin';
import { SignedUp } from './utils/factories';
import { Admin, shopper, testIban } from './utils/shopping';
import {
  Doctor,
  addClinic,
  approvedDoctor,
  expectOk,
  fullProfile,
  setSchedule,
  specialtyId,
} from './utils/health';
import {
  JaasProvider,
  PublicJitsiProvider,
  VideoJoin,
  VideoParticipant,
  VideoProvider,
} from '../src/modules/healthcare/video/video-provider';
import {
  ModelSuggestion,
  SymptomModel,
} from '../src/modules/healthcare/symptom-checker/symptom-model';
import { HealthJobsService } from '../src/modules/healthcare/jobs/health-jobs.service';

const ALL_DAY = [0, 1, 2, 3, 4, 5, 6].map(
  (w) => [w, '00:00', '24:00'] as [number, string, string],
);

/** Lets one test switch to JaaS without a second app. */
class SwitchableVideo extends VideoProvider {
  current: VideoProvider = new PublicJitsiProvider();
  get name() {
    return this.current.name;
  }
  join(
    room: string,
    who: VideoParticipant,
    until: Date,
    now?: Date,
  ): VideoJoin {
    return this.current.join(room, who, until, now);
  }
}

/** A scripted model: counts calls; `next` decides the answer (null = failure). */
class FakeModel extends SymptomModel {
  enabled = true;
  calls = 0;
  next: ModelSuggestion | null = null;
  async suggest() {
    this.calls += 1;
    return this.next;
  }
}

describe('Healthcare P6: video and symptom checker (e2e)', () => {
  let t: TestApp;
  let admin: Admin;
  let jobs: HealthJobsService;
  const video = new SwitchableVideo();
  const model = new FakeModel();

  const sql = (q: string, p: unknown[] = []) => t.ds.query(q, p);

  async function videoDoctor(prepay = false) {
    const d = await approvedDoctor(t, admin);
    await expectOk(
      await d.api.patch('/health/doctor/profile', {
        ...fullProfile(d, await specialtyId(t, 'psychiatrist')),
        minNoticeMinutes: 0,
        cancelCutoffMinutes: 60,
      }),
    );
    if (prepay) {
      await expectOk(
        await d.api.post('/health/doctor/payment-accounts', {
          kind: 'bank',
          accountTitle: 'Dr Video',
          accountNumber: testIban(),
          bankName: 'HBL',
        }),
        201,
      );
      await expectOk(
        await d.api.patch('/health/doctor/profile', {
          videoPrepayRequired: true,
        }),
      );
    }
    const loc = await expectOk(
      await d.api.post('/health/doctor/locations', {
        kind: 'video',
        fee: 2500,
        slotMinutes: 30,
      }),
      201,
    );
    await setSchedule(d, loc.id, ALL_DAY);
    await expectOk(await d.api.post('/health/doctor/listing/publish'));
    return { d, loc };
  }

  async function book(p: SignedUp, d: Doctor, locationId: string, index = 0) {
    const slots = await new ApiClient(t.http)
      .get(`/health/doctors/${d.doctorId}/locations/${locationId}/slots?days=2`)
      .expect(200);
    return expectOk(
      await p.api
        .post('/health/appointments', {
          doctorId: d.doctorId,
          locationId,
          startsAt: slots.body.data.days[1].slots[index].startsAt,
        })
        .set('Idempotency-Key', randomUUID()),
      201,
    );
  }

  /** Start in `minutes` (negative = already started), 30-minute slot. */
  const startsIn = (code: string, minutes: number) =>
    sql(
      `UPDATE appointments SET starts_at = now() + make_interval(mins => $2),
              ends_at = now() + make_interval(mins => $2) + interval '30 minutes'
        WHERE code = $1`,
      [code, minutes],
    );

  const join = (who: SignedUp, code: string, doctor = false) =>
    who.api.post(
      doctor
        ? `/health/doctor/appointments/${code}/video/join`
        : `/health/appointments/${code}/video/join`,
    );

  beforeAll(async () => {
    t = await createTestApp({
      override: (b) =>
        b
          .overrideProvider(VideoProvider)
          .useValue(video)
          .overrideProvider(SymptomModel)
          .useValue(model),
    });
    jobs = t.app.get(HealthJobsService);
    admin = await enrolledAdmin(t);
  });
  afterAll(() => t.close());

  describe('video', () => {
    it('window, participants only, doctor join starts the consultation, closed after completion', async () => {
      const { d, loc } = await videoDoctor();
      const { d: otherDoctor } = await videoDoctor();
      const p = await shopper(t);
      const stranger = await shopper(t);
      const a = await book(p, d, loc.id);

      const early = await join(p, a.code);
      expect(early.status).toBe(409);
      expect(early.body.error).toMatchObject({
        code: 'VIDEO_NOT_JOINABLE',
        details: { reason: 'window' },
      });
      expect(early.body.error.details.opensAt).toBeDefined();

      await startsIn(a.code, 8); // inside the 10-minute early window
      const [{ video_room }] = await sql(
        `SELECT video_room FROM appointments WHERE code = $1`,
        [a.code],
      );
      const pj = await expectOk(await join(p, a.code));
      expect(pj).toMatchObject({
        appointmentCode: a.code,
        provider: 'public_jitsi',
        domain: 'meet.jit.si',
        roomName: `mm-${video_room}`,
        moderator: false,
        jwt: null,
      });
      expect(pj.joinUrl).toContain(`https://meet.jit.si/mm-${video_room}`);
      const view = await expectOk(
        await p.api.get(`/health/appointments/${a.code}`),
      );
      expect(view.can.joinVideo).toBe(true);

      // Nobody else gets near the room.
      expect((await join(stranger, a.code)).status).toBe(404);
      expect((await join(otherDoctor, a.code, true)).status).toBe(404);

      const dj = await expectOk(await join(d, a.code, true));
      expect(dj).toMatchObject({ status: 'in_consultation', moderator: true });
      expect(dj.roomName).toBe(pj.roomName);
      // Rejoins work and aren't logged twice.
      await expectOk(await join(p, a.code));
      await expectOk(await join(d, a.code, true));
      const joined = await sql(
        `SELECT e.actor_role FROM appointment_events e JOIN appointments a ON a.id = e.appointment_id
          WHERE a.code = $1 AND e.note = 'Joined the video call' ORDER BY e.actor_role`,
        [a.code],
      );
      expect(joined.map((r: any) => r.actor_role).sort()).toEqual([
        'doctor',
        'patient',
      ]);

      await expectOk(
        await d.api.post(`/health/doctor/appointments/${a.code}/complete`),
      );
      const after = await join(p, a.code);
      expect(after.status).toBe(409);
      expect(after.body.error.details.reason).toBe('status');

      // Too late: 30 minutes after the end.
      const b = await book(p, d, loc.id, 2);
      await startsIn(b.code, -61);
      const late = await join(p, b.code);
      expect(late.status).toBe(409);
      expect(late.body.error.details.reason).toBe('window');
    });

    it('a clinic visit has no call; a required prepayment must be confirmed first', async () => {
      const clinicDoctor = await approvedDoctor(t, admin);
      await expectOk(
        await clinicDoctor.api.patch('/health/doctor/profile', {
          ...fullProfile(clinicDoctor, await specialtyId(t, 'dermatologist')),
          minNoticeMinutes: 0,
        }),
      );
      const clinic = await addClinic(clinicDoctor);
      await setSchedule(clinicDoctor, clinic.id, ALL_DAY);
      await expectOk(
        await clinicDoctor.api.post('/health/doctor/listing/publish'),
      );
      const p = await shopper(t);
      const c = await book(p, clinicDoctor, clinic.id);
      const noCall = await join(p, c.code);
      expect(noCall.status).toBe(409);
      expect(noCall.body.error.details.reason).toBe('not_video');

      const { d, loc } = await videoDoctor(true);
      const payer = await shopper(t);
      const a = await book(payer, d, loc.id);
      expect(a.payment).toMatchObject({ status: 'awaiting_transfer' });
      expect(a.payment.payBy).not.toBeNull();
      await startsIn(a.code, 5);
      const unpaid = await join(payer, a.code);
      expect(unpaid.status).toBe(402);
      expect(unpaid.body.error.code).toBe('PAYMENT_REQUIRED');
      expect((await join(d, a.code, true)).status).toBe(402);
      await expectOk(
        await d.api.post(
          `/health/doctor/appointments/${a.code}/payment/confirm`,
        ),
      );
      await expectOk(await join(payer, a.code));
    });

    it('JaaS: a signed RS256 room token per participant; the doctor is moderator', async () => {
      const { privateKey, publicKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
      });
      const appId = 'vpaas-magic-cookie-0123456789abcdef0123456789abcdef';
      video.current = new JaasProvider({
        appId,
        kid: `${appId}/k1`,
        privateKey,
      });
      try {
        const { d, loc } = await videoDoctor();
        const p = await shopper(t);
        const a = await book(p, d, loc.id);
        await startsIn(a.code, 0);
        const verify = (jwt: string) =>
          new JwtService().verify(jwt, {
            publicKey,
            algorithms: ['RS256'],
            audience: 'jitsi',
            issuer: 'chat',
          });
        const pj = await expectOk(await join(p, a.code));
        const dj = await expectOk(await join(d, a.code, true));
        const pc = verify(pj.jwt);
        const dc = verify(dj.jwt);
        expect(pc).toMatchObject({
          sub: appId,
          room: pj.roomName.split('/')[1],
        });
        expect(pc.context.user.moderator).toBe('false');
        expect(dc.context.user.moderator).toBe('true');
        expect(dc.context.user.name).toMatch(/^Dr\. /);
        // Never past the join window (ends + 30 min).
        const [{ closes }] = await sql(
          `SELECT extract(epoch FROM ends_at + interval '30 minutes')::int AS closes FROM appointments WHERE code = $1`,
          [a.code],
        );
        expect(dc.exp).toBeLessThanOrEqual(closes);
        expect(pj.joinUrl).toBe(`https://8x8.vc/${pj.roomName}?jwt=${pj.jwt}`);
      } finally {
        video.current = new PublicJitsiProvider();
      }
    });
  });

  describe('symptom checker', () => {
    const check = (p: SignedUp, body: object) =>
      p.api.post('/health/symptom-check', body);

    it('red flags answer with an emergency and never call the model', async () => {
      const p = await shopper(t);
      model.calls = 0;
      for (const text of [
        'seene mein dard aur pasina aa raha hai',
        "My father can't breathe properly since an hour",
      ]) {
        const r = await expectOk(await check(p, { text }));
        expect(r).toMatchObject({ emergency: true, source: 'red_flag' });
        expect(r.contacts.map((c: any) => c.number)).toEqual(['1122', '115']);
        expect(r.disclaimer).toMatch(/not a diagnosis/);
      }
      expect(model.calls).toBe(0);
      const [row] = await sql(
        `SELECT source, emergency FROM symptom_checks WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [p.userId],
      );
      expect(row).toEqual({ source: 'red_flag', emergency: true });
    });

    it('uses the model when it answers, and falls back cleanly when it fails', async () => {
      const p = await shopper(t);
      model.enabled = true;
      model.next = {
        specialtySlug: 'dermatologist',
        alternativeSlugs: ['general-physician'],
        urgency: 'routine',
        advice: 'A dermatologist can help with this.',
      };
      const viaModel = await expectOk(
        await check(p, {
          text: 'Pimples on my face and back for six months',
          age: 22,
        }),
      );
      expect(viaModel).toMatchObject({
        emergency: false,
        source: 'model',
        urgency: 'routine',
        specialty: { slug: 'dermatologist' },
        alternatives: [{ slug: 'general-physician' }],
        advice: 'A dermatologist can help with this.',
      });

      model.next = null; // timeout, bad JSON, unknown slug… all look like this
      const fallback = await expectOk(
        await check(p, { text: 'Pimples on my face and back for six months' }),
      );
      expect(fallback).toMatchObject({
        emergency: false,
        source: 'fallback',
        specialty: { slug: 'dermatologist' },
      });
      expect(fallback.possibleConditions.map((c: any) => c.name)).toContain(
        'Acne',
      );
      expect(fallback.disclaimer).toBeDefined();

      model.enabled = false; // no key configured
      const calls = model.calls;
      const unknown = await expectOk(
        await check(p, { text: 'something feels off today, not sure what' }),
      );
      expect(unknown).toMatchObject({
        source: 'fallback',
        specialty: { slug: 'general-physician' },
        urgency: 'routine',
      });
      const urdu = await expectOk(
        await check(p, { text: 'tezabiat aur pait mein jalan bohat zyada' }),
      );
      expect(urdu).toMatchObject({
        specialty: { slug: 'gastroenterologist' },
        urgency: 'soon',
      });
      expect(model.calls).toBe(calls);
      model.enabled = true;
    });

    it('10 checks per user per hour, counted in the database', async () => {
      const p = await shopper(t);
      model.enabled = false;
      for (let i = 0; i < 10; i++)
        await expectOk(
          await check(p, { text: `mild rash on my arm, day ${i}` }),
        );
      const over = await check(p, { text: 'mild rash on my arm again' });
      expect(over.status).toBe(429);
      expect(over.body.error.code).toBe('SYMPTOM_CHECK_LIMIT');
      expect(over.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
      // An hour later the window has moved on.
      await sql(
        `UPDATE symptom_checks SET created_at = created_at - interval '61 minutes' WHERE user_id = $1`,
        [p.userId],
      );
      await expectOk(await check(p, { text: 'mild rash on my arm again' }));
      model.enabled = true;
    });

    it('family members are the caller’s own; free text is purged after 30 days', async () => {
      const p = await shopper(t);
      const other = await shopper(t);
      const kid = await expectOk(
        await other.api.post('/health/family-members', {
          fullName: 'Not Yours',
          relation: 'child',
        }),
        201,
      );
      expect(
        (
          await check(p, {
            text: 'mild rash on my arm',
            familyMemberId: kid.id,
          })
        ).status,
      ).toBe(404);

      model.enabled = false;
      await expectOk(await check(p, { text: 'mild rash on my arm, old one' }));
      await expectOk(await check(p, { text: 'mild rash on my arm, new one' }));
      await sql(
        `UPDATE symptom_checks SET created_at = now() - interval '31 days'
          WHERE user_id = $1 AND text LIKE '%old one'`,
        [p.userId],
      );
      const counts = await jobs.nightlyRun();
      expect(counts.symptomTextPurged).toBeGreaterThanOrEqual(1);
      const rows = await sql(
        `SELECT text, source FROM symptom_checks WHERE user_id = $1 ORDER BY created_at`,
        [p.userId],
      );
      expect(rows).toEqual([
        { text: null, source: 'fallback' },
        { text: 'mild rash on my arm, new one', source: 'fallback' },
      ]);
      model.enabled = true;
    });

    it('validation and roles', async () => {
      const p = await shopper(t);
      expect((await check(p, { text: 'short' })).status).toBe(400);
      const d = await approvedDoctor(t, admin);
      expect((await check(d, { text: 'mild rash on my arm' })).status).toBe(
        403,
      );
      expect(
        (
          await new ApiClient(t.http).post('/health/symptom-check', {
            text: 'mild rash on my arm',
          })
        ).status,
      ).toBe(401);
    });
  });
});
