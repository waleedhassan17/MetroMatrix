import { Injectable } from '@nestjs/common';
import { User } from '../users/entities/user.entity';
import { AccountView, toAuthUser } from './auth-result';

/**
 * Builds the `{ user, business }` view shared by every auth response and by
 * GET /auth/me, so the app always routes on the same shape.
 */
@Injectable()
export class AccountViewService {
  async view(user: User): Promise<AccountView> {
    return { user: toAuthUser(user), business: null };
  }
}
