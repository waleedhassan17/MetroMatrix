import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BusinessesModule } from '../businesses/businesses.module';
import { MediaModule } from '../media/media.module';
import { Specialty } from './reference/entities/specialty.entity';
import { Condition } from './reference/entities/condition.entity';
import { ConditionSpecialty } from './reference/entities/condition-specialty.entity';
import { Medicine } from './reference/entities/medicine.entity';
import { Doctor } from './doctors/entities/doctor.entity';
import {
  DoctorCondition,
  DoctorExperience,
  DoctorQualification,
  DoctorServiceItem,
  DoctorSpecialty,
} from './doctors/entities/doctor-children.entity';
import { DoctorPaymentAccount } from './doctors/entities/doctor-payment-account.entity';
import { PracticeLocation } from './practice/entities/practice-location.entity';
import { WeeklySchedule } from './practice/entities/weekly-schedule.entity';
import { TimeOff } from './practice/entities/time-off.entity';
import { FamilyMember } from './family/entities/family-member.entity';
import { Appointment } from './appointments/entities/appointment.entity';
import { AppointmentEvent } from './appointments/entities/appointment-event.entity';
import { ReferenceService } from './reference/reference.service';
import { SearchSuggestService } from './reference/search-suggest.service';
import { ReferenceController } from './reference/reference.controller';
import { HealthEvents } from './common/health-events';
import { DoctorGuard } from './common/doctor.guard';
import { DoctorsService } from './doctors/doctors.service';
import { DoctorProfileController } from './doctors/doctors.controller';
import { PracticeService } from './practice/practice.service';
import { PracticeController } from './practice/practice.controller';
import { DiscoveryService } from './discovery/discovery.service';
import { DiscoveryController } from './discovery/discovery.controller';
import { AdminHealthService } from './admin/admin-health.service';
import { AvailabilityService } from './availability/availability.service';
import { FamilyService } from './family/family.service';
import { FamilyController } from './family/family.controller';
import { AppointmentTransitionsService } from './appointments/appointment-transitions.service';
import { AppointmentViewsService } from './appointments/appointment-views.service';
import {
  APPOINTMENT_FAULT_INJECTOR,
  AppointmentsService,
  noAppointmentFaults,
} from './appointments/appointments.service';
import {
  DoctorAppointmentPaymentsController,
  PatientAppointmentsController,
} from './appointments/appointments.controller';
import { HealthJobsService } from './jobs/health-jobs.service';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminHealthController } from './admin/admin-health.controller';
import {
  DoctorMedicineFavourite,
  Prescription,
  PrescriptionMedicine,
  PrescriptionTest,
} from './prescriptions/entities/prescription.entity';
import { MedicalNote } from './consultation/entities/medical-note.entity';
import { ConsultationService } from './consultation/consultation.service';
import { ConsultationController } from './consultation/consultation.controller';
import { PrescriptionsService } from './prescriptions/prescriptions.service';
import {
  DoctorPrescriptionsController,
  PatientPrescriptionsController,
} from './prescriptions/prescriptions.controller';
import { DoctorInsightsService } from './insights/doctor-insights.service';
import { HealthRecord } from './records/entities/health-record.entity';
import { AppointmentAttachment } from './records/entities/appointment-attachment.entity';
import { RecordsService } from './records/records.service';
import {
  AppointmentAttachmentsController,
  DoctorRecordsController,
  RecordsController,
} from './records/records.controller';
import { DoctorReview } from './reviews/entities/doctor-review.entity';
import { ReviewsService } from './reviews/reviews.service';
import { DoctorAggregatesService } from './reviews/doctor-aggregates.service';
import {
  AdminReviewsController,
  DoctorReviewsController,
  PatientReviewsController,
  PublicReviewsController,
} from './reviews/reviews.controller';
import {
  JaasConfig,
  JaasProvider,
  PublicJitsiProvider,
  VideoProvider,
} from './video/video-provider';
import { VideoService } from './video/video.service';
import {
  DoctorVideoController,
  PatientVideoController,
} from './video/video.controller';
import { SymptomCheck } from './symptom-checker/entities/symptom-check.entity';
import {
  GeminiSymptomModel,
  SymptomModel,
} from './symptom-checker/symptom-model';
import { SymptomCheckerService } from './symptom-checker/symptom-checker.service';
import { SymptomCheckerController } from './symptom-checker/symptom-checker.controller';

/**
 * MetroMatrix Healthcare. Sub-domains live in their own folders (reference,
 * discovery, doctors, practice, availability, appointments, family, records,
 * prescriptions, reviews, video, symptom-checker, insights, admin); this
 * module wires them together. Routes are under /api/v1/health.
 *
 * No money is held: patients pay at the clinic or transfer straight to the
 * doctor's own account.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Specialty,
      Condition,
      ConditionSpecialty,
      Medicine,
      Doctor,
      DoctorSpecialty,
      DoctorQualification,
      DoctorExperience,
      DoctorServiceItem,
      DoctorCondition,
      DoctorPaymentAccount,
      PracticeLocation,
      WeeklySchedule,
      TimeOff,
      FamilyMember,
      Appointment,
      AppointmentEvent,
      Prescription,
      PrescriptionMedicine,
      PrescriptionTest,
      DoctorMedicineFavourite,
      MedicalNote,
      HealthRecord,
      AppointmentAttachment,
      DoctorReview,
      SymptomCheck,
    ]),
    BusinessesModule,
    MediaModule,
    AuthModule,
    NotificationsModule,
  ],
  controllers: [
    ReferenceController,
    DiscoveryController,
    DoctorProfileController,
    PracticeController,
    AdminHealthController,
    FamilyController,
    PatientAppointmentsController,
    DoctorAppointmentPaymentsController,
    ConsultationController,
    DoctorPrescriptionsController,
    PatientPrescriptionsController,
    RecordsController,
    AppointmentAttachmentsController,
    DoctorRecordsController,
    PublicReviewsController,
    PatientReviewsController,
    DoctorReviewsController,
    AdminReviewsController,
    PatientVideoController,
    DoctorVideoController,
    SymptomCheckerController,
  ],
  providers: [
    HealthEvents,
    ReferenceService,
    SearchSuggestService,
    DoctorsService,
    DoctorGuard,
    PracticeService,
    AvailabilityService,
    DiscoveryService,
    AdminHealthService,
    FamilyService,
    AppointmentTransitionsService,
    AppointmentViewsService,
    AppointmentsService,
    { provide: APPOINTMENT_FAULT_INJECTOR, useValue: noAppointmentFaults },
    HealthJobsService,
    ConsultationService,
    PrescriptionsService,
    DoctorInsightsService,
    RecordsService,
    DoctorAggregatesService,
    ReviewsService,
    {
      provide: VideoProvider,
      inject: [ConfigService],
      useFactory: (config: ConfigService): VideoProvider =>
        config.get('integrations.video.provider') === 'jaas'
          ? new JaasProvider(
              config.getOrThrow<JaasConfig>('integrations.video.jaas'),
            )
          : new PublicJitsiProvider(),
    },
    VideoService,
    {
      provide: SymptomModel,
      inject: [ConfigService],
      useFactory: (config: ConfigService): SymptomModel =>
        new GeminiSymptomModel(
          config.get<string>('integrations.gemini.apiKey', ''),
          config.get<string>('integrations.gemini.model', 'gemini-2.5-flash'),
        ),
    },
    SymptomCheckerService,
  ],
})
export class HealthcareModule {}
