import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Business } from '../businesses/entities/business.entity';
import { AccountView, BusinessSummary, toAuthUser } from './auth-result';

/**
 * Builds the `{ user, business }` view shared by every auth response and by
 * GET /auth/me, so the app always routes on the same shape.
 */
@Injectable()
export class AccountViewService {
  constructor(private readonly dataSource: DataSource) {}

  async view(user: User): Promise<AccountView> {
    return { user: toAuthUser(user), business: await this.businessOf(user) };
  }

  /** A partner's business summary; null for everyone else. */
  private async businessOf(user: User): Promise<BusinessSummary | null> {
    if (user.role !== 'partner') return null;
    const b = await this.dataSource
      .getRepository(Business)
      .findOne({ where: { ownerUserId: user.id } });
    if (!b) return null;
    return {
      id: b.id,
      name: b.name,
      slug: b.slug,
      serviceType: b.serviceType,
      subType: b.subType,
      status: b.status,
      rejectionReason: b.rejectionReason,
      suspensionReason: b.suspensionReason,
      submittedAt: b.submittedAt,
    };
  }
}
