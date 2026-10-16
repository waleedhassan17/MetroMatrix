import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Appointment } from './entities/appointment.entity';
import {
  AppointmentEvent,
  AppointmentEventKind,
} from './entities/appointment-event.entity';
import {
  AppointmentActor,
  AppointmentStatus,
  STATUS_TIMESTAMP,
  assertTransition,
} from './appointment-status';
import {
  PAYMENT_ON_CANCEL,
  PAYMENT_ON_NO_SHOW,
  PaymentStatus,
  assertPaymentTransition,
} from './payment-status';
import { invalidTransition } from '../../../common/state/transitions';
import { ErrorCode } from '../../../common/errors/codes';

export interface Actor {
  role: AppointmentActor;
  userId: string | null;
}

export const SYSTEM: Actor = { role: 'system', userId: null };

/**
 * The only code that changes an appointment's status or payment status:
 * checked against the state machine for the actor, applied with a
 * conditional UPDATE (… WHERE status = :from), recorded as an event — all in
 * the caller's transaction. A cancel or no-show settles the payment too.
 */
@Injectable()
export class AppointmentTransitionsService {
  /** Lock one appointment, scoped to its patient account or its doctor. */
  async lock(
    m: EntityManager,
    where: { code: string; patientUserId?: string; doctorId?: string },
  ): Promise<Appointment> {
    const a = await m.findOne(Appointment, {
      where: { ...where, code: where.code.toUpperCase() },
      lock: { mode: 'pessimistic_write' },
    });
    if (!a)
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Appointment not found.',
      });
    return a;
  }

  async moveStatus(
    m: EntityManager,
    a: Appointment,
    to: AppointmentStatus,
    actor: Actor,
    opts: {
      note?: string | null;
      patch?: Partial<Appointment>;
      message?: string;
      settle?: boolean;
    } = {},
  ): Promise<void> {
    const from = a.status;
    assertTransition(from, to, actor.role, a.kind, opts.message);
    const patch: Partial<Appointment> = { ...opts.patch, status: to };
    const stamp = STATUS_TIMESTAMP[to];
    if (stamp) (patch as Record<string, unknown>)[stamp] = new Date();
    await this.update(m, a, patch, { status: from }, from, to);
    await this.event(m, a.id, 'status', from, to, actor, opts.note ?? null);
    if (opts.settle === false) return;
    const settle =
      to === 'cancelled'
        ? PAYMENT_ON_CANCEL
        : to === 'no_show'
          ? PAYMENT_ON_NO_SHOW
          : null;
    const next = settle?.[a.paymentStatus];
    if (next) await this.movePayment(m, a, next, actor);
  }

  async movePayment(
    m: EntityManager,
    a: Appointment,
    to: PaymentStatus,
    actor: Actor,
    opts: {
      note?: string | null;
      patch?: Partial<Appointment>;
      message?: string;
    } = {},
  ): Promise<void> {
    const from = a.paymentStatus;
    assertPaymentTransition(from, to, actor.role, opts.message);
    const patch: Partial<Appointment> = { ...opts.patch, paymentStatus: to };
    if (to === 'paid') patch.paidAt = new Date();
    if (to === 'refunded') patch.refundedAt = new Date();
    await this.update(m, a, patch, { paymentStatus: from }, from, to);
    await this.event(m, a.id, 'payment', from, to, actor, opts.note ?? null);
  }

  async note(
    m: EntityManager,
    appointmentId: string,
    actor: Actor,
    note: string,
  ): Promise<void> {
    await this.event(m, appointmentId, 'note', null, null, actor, note);
  }

  async event(
    m: EntityManager,
    appointmentId: string,
    kind: AppointmentEventKind,
    from: string | null,
    to: string | null,
    actor: Actor,
    note: string | null,
  ) {
    await m.insert(AppointmentEvent, {
      appointmentId,
      kind,
      from,
      to,
      actorRole: actor.role,
      actorUserId: actor.userId,
      note,
    });
  }

  private async update(
    m: EntityManager,
    a: Appointment,
    patch: Partial<Appointment>,
    guard: Partial<Pick<Appointment, 'status' | 'paymentStatus'>>,
    from: string,
    to: string,
  ) {
    const res = await m
      .createQueryBuilder()
      .update(Appointment)
      .set(patch)
      .where({ id: a.id, ...guard })
      .execute();
    if (res.affected !== 1)
      throw invalidTransition(
        from,
        to,
        [],
        'This appointment just changed — refresh and try again.',
      );
    Object.assign(a, patch);
  }
}
