import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

/** What PartnerStoreGuard puts on the request. */
export interface PartnerStore {
  id: string;
  businessId: string;
  /** The partner's user id (the business owner). */
  ownerUserId: string;
}

/**
 * The signed-in partner's store. Every partner service call takes `store.id`
 * as its scope, so a row of another store is simply never found (404).
 */
export const CurrentStore = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PartnerStore => {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { store?: PartnerStore }>();
    return req.store!;
  },
);
