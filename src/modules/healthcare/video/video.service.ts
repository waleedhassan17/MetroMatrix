import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { VideoProvider } from './video-provider';
import { Appointment } from '../appointments/entities/appointment.entity';
import {
  AppointmentTransitionsService,
  Actor,
} from '../appointments/appointment-transitions.service';
import {
  AppointmentViewsService,
  JOIN_EARLY_MS,
  JOIN_LATE_MS,
  notFound,
  videoJoinState,
} from '../appointments/appointment-views.service';
import { ErrorCode } from '../../../common/errors/codes';

const JOINED = 'Joined the video call';

/**
 * Joining a video consultation. Only the two participants ever reach a room
 * (anyone else: 404); the window is starts − 10 min … ends + 30 min; a
 * required prepayment must be confirmed. The doctor joining starts the
 * consultation (booked → in_consultation).
 */
@Injectable()
export class VideoService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly provider: VideoProvider,
    private readonly transitions: AppointmentTransitionsService,
    private readonly views: AppointmentViewsService,
  ) {}

  private window(a: Appointment) {
    return {
      opensAt: new Date(a.startsAt.getTime() - JOIN_EARLY_MS),
      closesAt: new Date(a.endsAt.getTime() + JOIN_LATE_MS),
    };
  }

  private assertJoinable(a: Appointment, now: Date) {
    const state = videoJoinState(a, now);
    if (state === 'ok') return;
    const { opensAt, closesAt } = this.window(a);
    if (state === 'payment') {
      throw new HttpException(
        {
          code: ErrorCode.PAYMENT_REQUIRED,
          message:
            'This consultation is prepaid: the doctor must confirm your transfer before the call.',
          details: { paymentStatus: a.paymentStatus, payBy: a.payBy },
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
    throw new ConflictException({
      code: ErrorCode.VIDEO_NOT_JOINABLE,
      message:
        state === 'window'
          ? 'The call opens 10 minutes before the appointment and closes 30 minutes after it.'
          : a.kind !== 'video'
            ? 'This is a clinic visit, not a video consultation.'
            : 'This appointment can no longer be joined.',
      details:
        state === 'window'
          ? { reason: 'window', opensAt, closesAt }
          : {
              reason: a.kind !== 'video' ? 'not_video' : 'status',
              status: a.status,
            },
    });
  }

  /** One "joined" event per participant role (rejoins aren't logged). */
  private async joinedOnce(m: EntityManager, a: Appointment, actor: Actor) {
    const [seen] = await m.query(
      `SELECT 1 FROM appointment_events WHERE appointment_id = $1 AND kind = 'note' AND actor_role = $2 AND note = $3 LIMIT 1`,
      [a.id, actor.role, JOINED],
    );
    if (!seen) await this.transitions.note(m, a.id, actor, JOINED);
  }

  async patientJoin(userId: string, code: string, now = new Date()) {
    const a = await this.dataSource.transaction(async (m) => {
      const a = await m.findOne(Appointment, {
        where: { code: code.toUpperCase(), patientUserId: userId },
      });
      if (!a) throw notFound();
      this.assertJoinable(a, now);
      await this.joinedOnce(m, a, { role: 'patient', userId });
      return a;
    });
    const { closesAt, opensAt } = this.window(a);
    return {
      appointmentCode: a.code,
      window: { opensAt, closesAt },
      ...this.provider.join(
        a.videoRoom!,
        { id: userId, name: a.patientSnapshot.name, moderator: false },
        closesAt,
        now,
      ),
    };
  }

  async doctorJoin(
    doctorId: string,
    doctorUserId: string,
    code: string,
    now = new Date(),
  ) {
    const a = await this.dataSource.transaction(async (m) => {
      const a = await this.transitions.lock(m, { code, doctorId });
      this.assertJoinable(a, now);
      const actor: Actor = { role: 'doctor', userId: doctorUserId };
      if (a.status === 'booked')
        await this.transitions.moveStatus(m, a, 'in_consultation', actor);
      await this.joinedOnce(m, a, actor);
      return a;
    });
    const { doctor } = await this.views.briefs([doctorId], []);
    const me = doctor.get(doctorId)!;
    const { closesAt, opensAt } = this.window(a);
    return {
      appointmentCode: a.code,
      status: a.status,
      window: { opensAt, closesAt },
      ...this.provider.join(
        a.videoRoom!,
        {
          id: doctorUserId,
          name: me.displayName,
          avatar: me.photoUrl,
          moderator: true,
        },
        closesAt,
        now,
      ),
    };
  }
}
