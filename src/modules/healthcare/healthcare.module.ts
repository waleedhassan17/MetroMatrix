import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Specialty } from './reference/entities/specialty.entity';
import { Condition } from './reference/entities/condition.entity';
import { ConditionSpecialty } from './reference/entities/condition-specialty.entity';
import { Medicine } from './reference/entities/medicine.entity';
import { ReferenceService } from './reference/reference.service';
import { SearchSuggestService } from './reference/search-suggest.service';
import { ReferenceController } from './reference/reference.controller';

/**
 * MetroMatrix Healthcare. Sub-domains live in their own folders (reference,
 * doctors, practice, availability, appointments, family, records,
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
    ]),
  ],
  controllers: [ReferenceController],
  providers: [ReferenceService, SearchSuggestService],
})
export class HealthcareModule {}
