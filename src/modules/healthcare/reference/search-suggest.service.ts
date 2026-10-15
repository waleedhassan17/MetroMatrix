import { Injectable } from '@nestjs/common';
import { ReferenceService } from './reference.service';

/**
 * Search-as-you-type across doctors, specialties and conditions. Doctors are
 * added by the discovery service once doctors exist (hook set in P2).
 */
@Injectable()
export class SearchSuggestService {
  doctors: (q: string, limit: number) => Promise<unknown[]> = async () => [];

  constructor(private readonly reference: ReferenceService) {}

  async suggest(q: string) {
    const [doctors, specialties, conditions] = await Promise.all([
      this.doctors(q, 5),
      this.reference.matchSpecialties(q, 3),
      this.reference.matchConditions(q, 3),
    ]);
    return { doctors, specialties, conditions };
  }
}
