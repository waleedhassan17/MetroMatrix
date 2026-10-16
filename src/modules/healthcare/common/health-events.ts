import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

export interface BookingRef {
  id: string;
  code: string;
  startsAt: Date;
  endsAt: Date;
  patientName: string;
}

/**
 * Seams between Healthcare sub-domains that would otherwise import each other
 * in a cycle (practice ⇄ appointments ⇄ availability). Each later sub-domain
 * fills in its part in onModuleInit; until then the defaults describe a
 * doctor with no bookings. One provider, so every caller sees the same wiring.
 */
@Injectable()
export class HealthEvents {
  /** Schedules, time off, bookings or listing changed: refresh caches and next-available. */
  availabilityChanged: (doctorId: string) => Promise<void> = async () =>
    undefined;

  /** Active appointments at a location from now on. */
  futureBookingsAtLocation: (
    m: EntityManager,
    locationId: string,
  ) => Promise<BookingRef[]> = async () => [];

  /** Has any appointment (past or future) ever used this location? */
  locationUsed: (m: EntityManager, locationId: string) => Promise<boolean> =
    async () => false;

  /** Active appointments of a doctor overlapping [from, to) — at one location or (null) any. */
  bookingsOverlapping: (
    m: EntityManager,
    doctorId: string,
    locationId: string | null,
    from: Date,
    to: Date,
  ) => Promise<BookingRef[]> = async () => [];

  /** Cancel these appointments as the system (time off with cancelAffected). Returns notices to send. */
  cancelForTimeOff: (
    m: EntityManager,
    appointmentIds: string[],
    reason: string,
  ) => Promise<() => Promise<void>> = async () => async () => undefined;
}
