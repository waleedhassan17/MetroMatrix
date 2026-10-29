import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Response shapes for admin-reference.controller.ts (Swagger only), checked
 * against real responses from the e2e suites.
 */

export class AdminAppointmentsListViewPatient {
  @ApiProperty({ type: String, nullable: true })
  age!: string | null;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String, nullable: true })
  phone!: string | null;
  @ApiProperty({ type: String, nullable: true })
  gender!: string | null;
  @ApiProperty({ type: String, nullable: true })
  relation!: string | null;
}

export class AdminAppointmentsListViewPayment {
  @ApiProperty({ type: String })
  method!: string;
  @ApiProperty({ type: String })
  status!: string;
  @ApiProperty({ type: String, nullable: true })
  payBy!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  paidAt!: string | null;
  @ApiProperty({ type: String, nullable: true })
  paymentRef!: string | null;
  @ApiProperty({ type: String, nullable: true })
  proofUrl!: string | null;
  @ApiProperty({ type: String, nullable: true })
  rejectedReason!: string | null;
  @ApiProperty({ type: String, nullable: true })
  accounts!: string | null;
  @ApiProperty({ type: String, nullable: true })
  refundRef!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  refundedAt!: string | null;
}

export class AdminAppointmentsListViewDoctor {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  businessId!: string;
  @ApiProperty({ type: String })
  displayName!: string;
  @ApiProperty({ type: String })
  specialty!: string;
}

export class AdminAppointmentsListViewLocation {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  kind!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String })
  city!: string;
  @ApiProperty({ type: String })
  timezone!: string;
}

export class AdminAppointmentsListView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  code!: string;
  @ApiProperty({ type: String })
  status!: string;
  @ApiProperty({ type: String })
  kind!: string;
  @ApiProperty({ type: String })
  startsAt!: string;
  @ApiProperty({ type: String })
  endsAt!: string;
  @ApiProperty({ type: () => AdminAppointmentsListViewPatient })
  patient!: AdminAppointmentsListViewPatient;
  @ApiProperty({ type: String, nullable: true })
  familyMemberId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  reason!: string | null;
  @ApiProperty({ type: [String] })
  symptoms!: string[];
  @ApiProperty({ type: 'integer' })
  fee!: number;
  @ApiProperty({ type: () => AdminAppointmentsListViewPayment })
  payment!: AdminAppointmentsListViewPayment;
  @ApiProperty({ type: Boolean })
  lateCancel!: boolean;
  @ApiProperty({ type: String, nullable: true })
  cancelledBy!: string | null;
  @ApiProperty({ type: String, nullable: true })
  cancelReason!: string | null;
  @ApiProperty({ type: String, nullable: true })
  rescheduledFromId!: string | null;
  @ApiProperty({ type: String })
  bookedAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  checkedInAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  startedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  completedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  cancelledAt!: string | null;
  @ApiProperty({ type: String })
  patientUserId!: string;
  @ApiProperty({ type: () => AdminAppointmentsListViewDoctor })
  doctor!: AdminAppointmentsListViewDoctor;
  @ApiProperty({ type: Boolean })
  hasPrescription!: boolean;
  @ApiProperty({ type: () => AdminAppointmentsListViewLocation })
  location!: AdminAppointmentsListViewLocation;
}

export class AdminAppointmentsDetailViewPatient {
  @ApiProperty({ type: String, nullable: true })
  age!: string | null;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String, nullable: true })
  phone!: string | null;
  @ApiProperty({ type: String, nullable: true })
  gender!: string | null;
  @ApiProperty({ type: String, nullable: true })
  relation!: string | null;
}

export class AdminAppointmentsDetailViewPayment {
  @ApiProperty({ type: String })
  method!: string;
  @ApiProperty({ type: String })
  status!: string;
  @ApiProperty({ type: String, nullable: true })
  payBy!: string | null;
  @ApiProperty({ type: String, nullable: true })
  paidAt!: string | null;
  @ApiProperty({ type: String, nullable: true })
  paymentRef!: string | null;
  @ApiProperty({ type: String, nullable: true })
  proofUrl!: string | null;
  @ApiProperty({ type: String, nullable: true })
  rejectedReason!: string | null;
  @ApiProperty({ type: String, nullable: true })
  accounts!: string | null;
  @ApiProperty({ type: String, nullable: true })
  refundRef!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  refundedAt!: string | null;
}

export class AdminAppointmentsDetailViewDoctor {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  businessId!: string;
  @ApiProperty({ type: String })
  displayName!: string;
  @ApiProperty({ type: String })
  specialty!: string;
}

export class AdminAppointmentsDetailViewLocation {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  kind!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String })
  city!: string;
  @ApiProperty({ type: String })
  timezone!: string;
}

export class AdminAppointmentsDetailViewEventsItem {
  @ApiProperty({ type: String })
  kind!: string;
  @ApiProperty({ type: String, nullable: true })
  from!: string | null;
  @ApiProperty({ type: String, nullable: true })
  to!: string | null;
  @ApiProperty({ type: String })
  actorRole!: string;
  @ApiProperty({ type: String })
  actorUserId!: string;
  @ApiProperty({ type: String, nullable: true })
  note!: string | null;
  @ApiProperty({ type: String })
  at!: string;
}

export class AdminAppointmentsDetailView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  code!: string;
  @ApiProperty({ type: String })
  status!: string;
  @ApiProperty({ type: String })
  kind!: string;
  @ApiProperty({ type: String })
  startsAt!: string;
  @ApiProperty({ type: String })
  endsAt!: string;
  @ApiProperty({ type: () => AdminAppointmentsDetailViewPatient })
  patient!: AdminAppointmentsDetailViewPatient;
  @ApiProperty({ type: String, nullable: true })
  familyMemberId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  reason!: string | null;
  @ApiProperty({ type: [String] })
  symptoms!: string[];
  @ApiProperty({ type: 'integer' })
  fee!: number;
  @ApiProperty({ type: () => AdminAppointmentsDetailViewPayment })
  payment!: AdminAppointmentsDetailViewPayment;
  @ApiProperty({ type: Boolean })
  lateCancel!: boolean;
  @ApiProperty({ type: String, nullable: true })
  cancelledBy!: string | null;
  @ApiProperty({ type: String, nullable: true })
  cancelReason!: string | null;
  @ApiProperty({ type: String, nullable: true })
  rescheduledFromId!: string | null;
  @ApiProperty({ type: String })
  bookedAt!: string;
  @ApiProperty({ type: String, nullable: true })
  checkedInAt!: string | null;
  @ApiProperty({ type: String, nullable: true })
  startedAt!: string | null;
  @ApiProperty({ type: String, nullable: true })
  completedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  cancelledAt!: string | null;
  @ApiProperty({ type: String })
  patientUserId!: string;
  @ApiProperty({ type: () => AdminAppointmentsDetailViewDoctor })
  doctor!: AdminAppointmentsDetailViewDoctor;
  @ApiProperty({ type: Boolean })
  hasPrescription!: boolean;
  @ApiProperty({ type: () => AdminAppointmentsDetailViewLocation })
  location!: AdminAppointmentsDetailViewLocation;
  @ApiProperty({ type: () => [AdminAppointmentsDetailViewEventsItem] })
  events!: AdminAppointmentsDetailViewEventsItem[];
}

export class AdminReferenceConditionsViewSpecialtiesItem {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String })
  slug!: string;
  @ApiProperty({ type: 'integer' })
  rank!: number;
}

export class AdminReferenceConditionsView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String, nullable: true })
  nameUr!: string | null;
  @ApiProperty({ type: String })
  slug!: string;
  @ApiProperty({ type: [String] })
  aliases!: string[];
  @ApiProperty({ type: Boolean })
  isCommon!: boolean;
  @ApiProperty({ type: String, nullable: true })
  icon!: string | null;
  @ApiProperty({ type: Boolean })
  isActive!: boolean;
  @ApiProperty({ type: () => [AdminReferenceConditionsViewSpecialtiesItem] })
  specialties!: AdminReferenceConditionsViewSpecialtiesItem[];
}

export class AdminAppointmentsOverviewViewDoctors {
  @ApiProperty({ type: 'integer' })
  total!: number;
  @ApiProperty({ type: 'integer' })
  listed!: number;
  @ApiProperty({ type: 'integer' })
  awaitingPmdc!: number;
  @ApiProperty({ type: 'integer' })
  unlistedByAdmin!: number;
}

export class AdminAppointmentsOverviewViewListedBySpecialtyItem {
  @ApiProperty({ type: String })
  slug!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: 'integer' })
  doctors!: number;
}

export class AdminAppointmentsOverviewViewTodayAppointmentsByStatus {
  @ApiPropertyOptional({ type: 'integer' })
  no_show?: number;
  @ApiPropertyOptional({ type: 'integer' })
  completed?: number;
  @ApiPropertyOptional({ type: 'integer' })
  in_consultation?: number;
  @ApiPropertyOptional({ type: 'integer' })
  booked?: number;
  @ApiPropertyOptional({ type: 'integer' })
  checked_in?: number;
  @ApiPropertyOptional({ type: 'integer' })
  cancelled?: number;
}

export class AdminAppointmentsOverviewViewToday {
  @ApiProperty({ type: 'integer' })
  newBookings!: number;
  @ApiProperty({ type: 'integer' })
  cancellations!: number;
  @ApiProperty({ type: 'integer' })
  noShows!: number;
  @ApiProperty({
    type: () => AdminAppointmentsOverviewViewTodayAppointmentsByStatus,
  })
  appointmentsByStatus!: AdminAppointmentsOverviewViewTodayAppointmentsByStatus;
}

export class AdminAppointmentsOverviewViewLast7Days {
  @ApiProperty({ type: 'integer' })
  booked!: number;
  @ApiProperty({ type: 'integer' })
  completed!: number;
  @ApiProperty({ type: 'integer' })
  cancelled!: number;
  @ApiProperty({ type: 'integer' })
  noShow!: number;
  @ApiProperty({ type: 'integer' })
  video!: number;
}

export class AdminAppointmentsOverviewViewReviews {
  @ApiProperty({ type: 'integer' })
  total!: number;
  @ApiProperty({ type: 'integer' })
  hidden!: number;
  @ApiProperty({ type: 'integer' })
  last7Days!: number;
}

export class AdminAppointmentsOverviewViewSymptomChecks {
  @ApiProperty({ type: 'integer' })
  last24h!: number;
  @ApiProperty({ type: 'integer' })
  emergencies24h!: number;
}

export class AdminAppointmentsOverviewViewTopSpecialties30dItem {
  @ApiProperty({ type: String })
  slug!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: 'integer' })
  bookings!: number;
}

export class AdminAppointmentsOverviewView {
  @ApiProperty({ type: String })
  date!: string;
  @ApiProperty({ type: () => AdminAppointmentsOverviewViewDoctors })
  doctors!: AdminAppointmentsOverviewViewDoctors;
  @ApiProperty({
    type: () => [AdminAppointmentsOverviewViewListedBySpecialtyItem],
  })
  listedBySpecialty!: AdminAppointmentsOverviewViewListedBySpecialtyItem[];
  @ApiProperty({ type: () => AdminAppointmentsOverviewViewToday })
  today!: AdminAppointmentsOverviewViewToday;
  @ApiProperty({ type: () => AdminAppointmentsOverviewViewLast7Days })
  last7Days!: AdminAppointmentsOverviewViewLast7Days;
  @ApiProperty({ type: () => AdminAppointmentsOverviewViewReviews })
  reviews!: AdminAppointmentsOverviewViewReviews;
  @ApiProperty({ type: () => AdminAppointmentsOverviewViewSymptomChecks })
  symptomChecks!: AdminAppointmentsOverviewViewSymptomChecks;
  @ApiProperty({
    type: () => [AdminAppointmentsOverviewViewTopSpecialties30dItem],
  })
  topSpecialties30d!: AdminAppointmentsOverviewViewTopSpecialties30dItem[];
}

export class AdminReferenceSpecialtiesView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String })
  nameUr!: string;
  @ApiProperty({ type: String })
  slug!: string;
  @ApiProperty({ type: String, nullable: true })
  icon!: string | null;
  @ApiProperty({ type: String, nullable: true })
  description!: string | null;
  @ApiProperty({ type: [String] })
  keywords!: string[];
  @ApiProperty({ type: 'integer' })
  sort!: number;
  @ApiProperty({ type: Boolean })
  isActive!: boolean;
  @ApiProperty({ type: 'integer' })
  doctors!: number;
}

export class AdminReferenceUpdateConditionViewSpecialtiesItem {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String })
  slug!: string;
  @ApiProperty({ type: 'integer' })
  rank!: number;
}

export class AdminReferenceUpdateConditionView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String, nullable: true })
  nameUr!: string | null;
  @ApiProperty({ type: String })
  slug!: string;
  @ApiProperty({ type: [String] })
  aliases!: string[];
  @ApiProperty({ type: Boolean })
  isCommon!: boolean;
  @ApiProperty({ type: String, nullable: true })
  icon!: string | null;
  @ApiProperty({
    type: () => [AdminReferenceUpdateConditionViewSpecialtiesItem],
  })
  specialties!: AdminReferenceUpdateConditionViewSpecialtiesItem[];
}

export class AdminReferenceUpdateSpecialtyView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String })
  nameUr!: string;
  @ApiProperty({ type: String })
  slug!: string;
  @ApiProperty({ type: String, nullable: true })
  icon!: string | null;
  @ApiProperty({ type: String, nullable: true })
  description!: string | null;
  @ApiProperty({ type: [String] })
  keywords!: string[];
  @ApiProperty({ type: 'integer' })
  sort!: number;
  @ApiPropertyOptional({ type: Boolean })
  isActive?: boolean;
}

export class AdminAppointmentsCancelViewPatient {
  @ApiProperty({ type: String, nullable: true })
  age!: string | null;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String, nullable: true })
  phone!: string | null;
  @ApiProperty({ type: String, nullable: true })
  gender!: string | null;
  @ApiProperty({ type: String, nullable: true })
  relation!: string | null;
}

export class AdminAppointmentsCancelViewPayment {
  @ApiProperty({ type: String })
  method!: string;
  @ApiProperty({ type: String })
  status!: string;
  @ApiProperty({ type: String, nullable: true })
  payBy!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  paidAt!: string | null;
  @ApiProperty({ type: String, nullable: true })
  paymentRef!: string | null;
  @ApiProperty({ type: String, nullable: true })
  proofUrl!: string | null;
  @ApiProperty({ type: String, nullable: true })
  rejectedReason!: string | null;
  @ApiProperty({ type: String, nullable: true })
  accounts!: string | null;
  @ApiProperty({ type: String, nullable: true })
  refundRef!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  refundedAt!: string | null;
}

export class AdminAppointmentsCancelViewDoctor {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  businessId!: string;
  @ApiProperty({ type: String })
  displayName!: string;
  @ApiProperty({ type: String })
  specialty!: string;
}

export class AdminAppointmentsCancelViewLocation {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  kind!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String })
  city!: string;
  @ApiProperty({ type: String })
  timezone!: string;
}

export class AdminAppointmentsCancelViewEventsItem {
  @ApiProperty({ type: String })
  kind!: string;
  @ApiProperty({ type: String, nullable: true })
  from!: string | null;
  @ApiProperty({ type: String })
  to!: string;
  @ApiProperty({ type: String })
  actorRole!: string;
  @ApiProperty({ type: String })
  actorUserId!: string;
  @ApiProperty({ type: String, nullable: true })
  note!: string | null;
  @ApiProperty({ type: String })
  at!: string;
}

export class AdminAppointmentsCancelView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  code!: string;
  @ApiProperty({ type: String })
  status!: string;
  @ApiProperty({ type: String })
  kind!: string;
  @ApiProperty({ type: String })
  startsAt!: string;
  @ApiProperty({ type: String })
  endsAt!: string;
  @ApiProperty({ type: () => AdminAppointmentsCancelViewPatient })
  patient!: AdminAppointmentsCancelViewPatient;
  @ApiProperty({ type: String, nullable: true })
  familyMemberId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  reason!: string | null;
  @ApiProperty({ type: [String] })
  symptoms!: string[];
  @ApiProperty({ type: 'integer' })
  fee!: number;
  @ApiProperty({ type: () => AdminAppointmentsCancelViewPayment })
  payment!: AdminAppointmentsCancelViewPayment;
  @ApiProperty({ type: Boolean })
  lateCancel!: boolean;
  @ApiProperty({ type: String })
  cancelledBy!: string;
  @ApiProperty({ type: String })
  cancelReason!: string;
  @ApiProperty({ type: String, nullable: true })
  rescheduledFromId!: string | null;
  @ApiProperty({ type: String })
  bookedAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  checkedInAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  startedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  completedAt!: string | null;
  @ApiProperty({ type: String })
  cancelledAt!: string;
  @ApiProperty({ type: String })
  patientUserId!: string;
  @ApiProperty({ type: () => AdminAppointmentsCancelViewDoctor })
  doctor!: AdminAppointmentsCancelViewDoctor;
  @ApiProperty({ type: Boolean })
  hasPrescription!: boolean;
  @ApiProperty({ type: () => AdminAppointmentsCancelViewLocation })
  location!: AdminAppointmentsCancelViewLocation;
  @ApiProperty({ type: () => [AdminAppointmentsCancelViewEventsItem] })
  events!: AdminAppointmentsCancelViewEventsItem[];
}

export class AdminReferenceCreateConditionView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String, nullable: true })
  nameUr!: string | null;
  @ApiProperty({ type: String })
  slug!: string;
  @ApiProperty({ type: [String] })
  aliases!: string[];
  @ApiProperty({ type: Boolean })
  isCommon!: boolean;
  @ApiProperty({ type: String, nullable: true })
  icon!: string | null;
  @ApiProperty({ type: Boolean })
  isActive!: boolean;
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  specialties!: unknown[];
}

export class AdminReferenceCreateSpecialtyView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String })
  nameUr!: string;
  @ApiProperty({ type: String })
  slug!: string;
  @ApiProperty({ type: String, nullable: true })
  icon!: string | null;
  @ApiProperty({ type: String, nullable: true })
  description!: string | null;
  @ApiProperty({ type: [String] })
  keywords!: string[];
  @ApiProperty({ type: 'integer' })
  sort!: number;
  @ApiProperty({ type: Boolean })
  isActive!: boolean;
}

export class AdminReferenceMapConditionViewSpecialtiesItem {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String })
  slug!: string;
  @ApiProperty({ type: 'integer' })
  rank!: number;
}

export class AdminReferenceMapConditionView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String, nullable: true })
  nameUr!: string | null;
  @ApiProperty({ type: String })
  slug!: string;
  @ApiProperty({ type: [String] })
  aliases!: string[];
  @ApiProperty({ type: Boolean })
  isCommon!: boolean;
  @ApiProperty({ type: String, nullable: true })
  icon!: string | null;
  @ApiProperty({ type: Boolean })
  isActive!: boolean;
  @ApiProperty({ type: () => [AdminReferenceMapConditionViewSpecialtiesItem] })
  specialties!: AdminReferenceMapConditionViewSpecialtiesItem[];
}
