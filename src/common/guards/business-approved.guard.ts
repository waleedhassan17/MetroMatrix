import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { DataSource } from 'typeorm';
import { AuthenticatedUser } from '../decorators/current-user.decorator';
import { ApprovedBusiness } from '../decorators/current-business.decorator';
import { assertEmailVerified } from '../utils/email-verified.util';
import { ErrorCode } from '../errors/codes';

/**
 * Every partner route from Chunk 2 on sits behind this guard (FinMatrix's
 * CompanyGuard pattern): the caller's business must be APPROVED right now.
 *
 * One indexed lookup per request, so a suspension takes effect on the very
 * next call — not when the partner's token happens to expire. Attaches the
 * business to the request for @CurrentBusiness().
 *
 * Use after @Roles('partner'):
 *   @Roles('partner') @UseGuards(BusinessApprovedGuard)
 */
/**
 * The caller's business, refused unless it is APPROVED right now (and the
 * email is verified). The guard's check as a function, for code that isn't
 * behind the guard — the voice endpoint serves several roles.
 */
export async function approvedBusinessOf(
  dataSource: DataSource,
  user: AuthenticatedUser | undefined,
): Promise<ApprovedBusiness> {
  assertEmailVerified(user);

  const rows: Array<{
    id: string;
    status: string;
    service_type: string;
    sub_type: string;
    suspension_reason: string | null;
  }> = user
    ? await dataSource.query(
        `SELECT id, status, service_type, sub_type, suspension_reason
           FROM businesses WHERE owner_user_id = $1 LIMIT 1`,
        [user.id],
      )
    : [];
  const row = rows[0];

  if (row?.status === 'suspended') {
    throw new ForbiddenException({
      code: ErrorCode.BUSINESS_SUSPENDED,
      message: 'Your business has been suspended.',
      details: { suspensionReason: row.suspension_reason },
    });
  }
  if (row?.status !== 'approved') {
    throw new ForbiddenException({
      code: ErrorCode.BUSINESS_NOT_APPROVED,
      message: !row
        ? 'Set up your business first.'
        : row.status === 'pending_approval'
          ? 'Your business is awaiting approval.'
          : row.status === 'rejected'
            ? 'Your business application needs changes.'
            : 'Finish setting up your business and submit it for approval.',
      details: { status: row?.status ?? null },
    });
  }

  return {
    id: row.id,
    status: 'approved',
    serviceType: row.service_type,
    subType: row.sub_type,
  };
}

@Injectable()
export class BusinessApprovedGuard implements CanActivate {
  constructor(private readonly dataSource: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<
        Request & { user?: AuthenticatedUser; business?: ApprovedBusiness }
      >();
    req.business = await approvedBusinessOf(this.dataSource, req.user);
    return true;
  }
}
