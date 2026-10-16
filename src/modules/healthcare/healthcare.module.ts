import { Module } from '@nestjs/common';
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
import { AdminHealthController } from './admin/admin-health.controller';

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
    ]),
    BusinessesModule,
    MediaModule,
  ],
  controllers: [
    ReferenceController,
    DiscoveryController,
    DoctorProfileController,
    PracticeController,
    AdminHealthController,
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
  ],
})
export class HealthcareModule {}
