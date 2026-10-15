import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { ApprovedBusiness } from '../../../common/decorators/current-business.decorator';
import { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import { StoresService } from '../stores/stores.service';
import { PartnerStore } from './current-store.decorator';

/**
 * Resolves the partner's store from their approved shopping business and puts
 * it on the request for @CurrentStore(). Runs after BusinessApprovedGuard and
 * ServiceTypeGuard('shopping').
 *
 * The store row is created when the business is approved; for a business
 * approved before Shopping existed it is created here, on first use.
 */
@Injectable()
export class PartnerStoreGuard implements CanActivate {
  constructor(private readonly stores: StoresService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<
      Request & {
        user?: AuthenticatedUser;
        business?: ApprovedBusiness;
        store?: PartnerStore;
      }
    >();
    const storeId = await this.stores.ensureForBusinessId(req.business!.id);
    req.store = {
      id: storeId,
      businessId: req.business!.id,
      ownerUserId: req.user!.id,
    };
    return true;
  }
}
