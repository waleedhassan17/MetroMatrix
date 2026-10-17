import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Request } from 'express';
import { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import { ErrorCode } from '../../../common/errors/codes';

export interface RiderRef {
  id: string;
  userId: string;
  businessId: string;
  brandId: string;
  branchId: string;
}

/**
 * Rider routes: the rider row must be `active` (not inactive, on leave or
 * plan-locked → 403 RIDER_INACTIVE) and their vendor's business approved
 * (suspended → 403 BUSINESS_SUSPENDED).
 */
@Injectable()
export class RiderGuard implements CanActivate {
  constructor(private readonly dataSource: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser; rider?: RiderRef }>();
    const [row] = await this.dataSource.query(
      `SELECT r.id, r.user_id, r.business_id, r.status, b.status AS business_status,
              fb.id AS brand_id, br.id AS branch_id
         FROM riders r JOIN businesses b ON b.id = r.business_id
         JOIN food_brands fb ON fb.business_id = b.id JOIN branches br ON br.business_id = b.id
        WHERE r.user_id = $1`,
      [req.user!.id],
    );
    if (!row || row.status !== 'active') {
      throw new ForbiddenException({
        code: ErrorCode.RIDER_INACTIVE,
        message:
          row?.status === 'plan_locked'
            ? "Your vendor's plan has no free rider seat for you right now. Ask them to free one."
            : 'Your rider account is not active. Ask your vendor to reactivate it.',
        details: { status: row?.status ?? null },
      });
    }
    if (row.business_status !== 'approved') {
      throw new ForbiddenException({
        code:
          row.business_status === 'suspended'
            ? ErrorCode.BUSINESS_SUSPENDED
            : ErrorCode.BUSINESS_NOT_APPROVED,
        message: 'Your vendor is not taking orders on MetroMatrix right now.',
      });
    }
    req.rider = {
      id: row.id,
      userId: row.user_id,
      businessId: row.business_id,
      brandId: row.brand_id,
      branchId: row.branch_id,
    };
    return true;
  }
}
