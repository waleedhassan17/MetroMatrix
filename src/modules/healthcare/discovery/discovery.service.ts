import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DOCTOR_FROM_SQL, LISTED_DOCTOR_SQL } from './listing-sql';
import { ErrorCode } from '../../../common/errors/codes';

export const notListed = () =>
  new NotFoundException({
    code: ErrorCode.DOCTOR_NOT_LISTED,
    message: 'This doctor is not taking bookings on MetroMatrix.',
  });

/** Public doctor discovery (expanded in P2: list, filters, slots, labels). */
@Injectable()
export class DiscoveryService {
  constructor(private readonly dataSource: DataSource) {}

  async assertListed(doctorId: string): Promise<void> {
    const [row] = await this.dataSource.query(
      `SELECT 1 ${DOCTOR_FROM_SQL} WHERE d.id = $1 AND ${LISTED_DOCTOR_SQL}`,
      [doctorId],
    );
    if (!row) throw notListed();
  }

  async profile(doctorId: string) {
    const [d] = await this.dataSource.query(
      `SELECT d.id, d.title, d.full_name FROM doctors d JOIN businesses b ON b.id = d.business_id
        WHERE d.id = $1 AND ${LISTED_DOCTOR_SQL}`,
      [doctorId],
    );
    if (!d) throw notListed();
    return { id: d.id, title: d.title, fullName: d.full_name };
  }
}
