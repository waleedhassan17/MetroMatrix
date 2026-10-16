import {
  invalidTransition,
  stateMachine,
} from '../../../common/state/transitions';

export const APPOINTMENT_STATUSES = [
  'booked',
  'checked_in',
  'in_consultation',
  'completed',
  'cancelled',
  'no_show',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** The statuses the exclusion constraint guards: they hold the doctor's time. */
export const ACTIVE_STATUSES = [
  'booked',
  'checked_in',
  'in_consultation',
] as const;

export const APPOINTMENT_ACTORS = [
  'patient',
  'doctor',
  'system',
  'admin',
] as const;
export type AppointmentActor = (typeof APPOINTMENT_ACTORS)[number];

/**
 * booked ──(clinic) check-in──▶ checked_in ──start──▶ in_consultation ──complete──▶ completed
 *   │      (video) start ─────────────────────────▶
 *   ├──▶ cancelled (patient, doctor, system, admin)
 *   └──▶ no_show   (doctor from starts + 15 min; system at ends + 2 h)
 */
export const APPOINTMENT_STATUS = stateMachine<AppointmentStatus>({
  booked: ['checked_in', 'in_consultation', 'cancelled', 'no_show'],
  checked_in: ['in_consultation', 'cancelled'],
  in_consultation: ['completed'],
  completed: [],
  cancelled: [],
  no_show: [],
});

const ACTORS: Partial<
  Record<
    `${AppointmentStatus}>${AppointmentStatus}`,
    readonly AppointmentActor[]
  >
> = {
  'booked>checked_in': ['doctor'],
  'booked>in_consultation': ['doctor'],
  'booked>cancelled': ['patient', 'doctor', 'system', 'admin'],
  'booked>no_show': ['doctor', 'system'],
  'checked_in>in_consultation': ['doctor'],
  'checked_in>cancelled': ['doctor', 'system', 'admin'],
  'in_consultation>completed': ['doctor'],
};

/** Where this actor may move an appointment of this kind. */
export function allowedMoves(
  from: AppointmentStatus,
  actor: AppointmentActor,
  kind: 'clinic' | 'video',
): AppointmentStatus[] {
  return APPOINTMENT_STATUS.allowed(from).filter((to) => {
    if (!ACTORS[`${from}>${to}`]?.includes(actor)) return false;
    // Video skips check-in; a clinic visit starts only after check-in.
    if (kind === 'video' && to === 'checked_in') return false;
    if (kind === 'clinic' && from === 'booked' && to === 'in_consultation')
      return false;
    return true;
  });
}

export const ALLOWED_TRANSITIONS = APPOINTMENT_STATUS.map;

/** 409 INVALID_TRANSITION { from, to, allowed } unless this actor may make the move. */
export function assertTransition(
  from: AppointmentStatus,
  to: AppointmentStatus,
  actor: AppointmentActor,
  kind: 'clinic' | 'video',
  message?: string,
): void {
  const allowed = allowedMoves(from, actor, kind);
  if (!allowed.includes(to))
    throw invalidTransition(from, to, allowed, message);
}

export const STATUS_TIMESTAMP: Partial<Record<AppointmentStatus, string>> = {
  checked_in: 'checkedInAt',
  in_consultation: 'startedAt',
  completed: 'completedAt',
  cancelled: 'cancelledAt',
};
