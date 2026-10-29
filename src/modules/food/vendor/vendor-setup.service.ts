import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Branch } from './entities/branch.entity';
import { FoodVendorService, VendorRef } from './food-vendor.service';
import { AccountViewService } from '../../auth/account-view.service';
import { OperationalAuditService } from '../../../common/audit/operational-audit.service';
import { ErrorCode } from '../../../common/errors/codes';

type SubType = VendorRef['subType'];

export interface SetupCheck {
  key: string;
  label: string;
  /** Which vendor kinds need it (all when absent). */
  subTypes?: SubType[];
  /** Skipped (not required) for this vendor right now — e.g. zones when delivery is off. */
  applies?: (m: EntityManager, v: VendorRef) => Promise<boolean>;
  done: (m: EntityManager, v: VendorRef) => Promise<boolean>;
}

const one = async (m: EntityManager, sql: string, params: unknown[]) =>
  !!(await m.query(sql, params))[0];

/**
 * The go-live checklist, by vendor kind. Each sub-domain registers its own
 * items (the menu adds "menu", home kitchens add portions/slots), so the
 * checklist and go-live always agree. A home kitchen also needs MetroMatrix's
 * food-safety check (FOOD_SAFETY_CHECK_REQUIRED).
 */
@Injectable()
export class VendorSetupService implements OnModuleInit {
  private readonly checks: SetupCheck[] = [];

  constructor(
    private readonly dataSource: DataSource,
    private readonly vendors: FoodVendorService,
    private readonly accounts: AccountViewService,
    private readonly audit: OperationalAuditService,
  ) {}

  register(check: SetupCheck): void {
    this.checks.push(check);
  }

  onModuleInit(): void {
    this.register({
      key: 'profile',
      label: 'Brand name, logo and at least one cuisine',
      done: (m, v) =>
        one(
          m,
          `SELECT 1 FROM food_brands WHERE id = $1 AND logo_url IS NOT NULL AND cardinality(cuisine_ids) > 0`,
          [v.brandId],
        ),
    });
    this.register({
      key: 'location',
      label: 'Address, map pin and phone',
      done: (m, v) =>
        one(
          m,
          `SELECT 1 FROM branches WHERE id = $1 AND geo IS NOT NULL AND address_line IS NOT NULL AND phone IS NOT NULL`,
          [v.branchId],
        ),
    });
    this.register({
      key: 'hours',
      label: 'Opening hours',
      done: (m, v) =>
        one(m, `SELECT 1 FROM branch_hours WHERE branch_id = $1 LIMIT 1`, [
          v.branchId,
        ]),
    });
    this.register({
      key: 'zones',
      label: 'Delivery fee bands',
      applies: (m, v) =>
        one(m, `SELECT 1 FROM branches WHERE id = $1 AND accepts_delivery`, [
          v.branchId,
        ]),
      done: (m, v) =>
        one(
          m,
          `SELECT 1 FROM delivery_fee_bands WHERE branch_id = $1 LIMIT 1`,
          [v.branchId],
        ),
    });
    this.register({
      key: 'payment',
      label: 'A way to be paid: cash, pay at pickup, or a transfer account',
      done: (m, v) =>
        one(
          m,
          `SELECT 1 FROM branches br WHERE br.id = $1 AND (
             (br.accepts_cod AND br.accepts_delivery) OR br.accepts_pickup
             OR EXISTS (SELECT 1 FROM vendor_payment_accounts a WHERE a.business_id = br.business_id AND a.is_active))`,
          [v.branchId],
        ),
    });
    this.register({
      key: 'food_safety',
      label: 'MetroMatrix food-safety check (after a test order)',
      subTypes: ['home_kitchen'],
      done: (m, v) =>
        one(
          m,
          `SELECT 1 FROM branches WHERE id = $1 AND food_safety_checked_at IS NOT NULL`,
          [v.branchId],
        ),
    });

    // Every session of a food vendor says which brand it is and whether it is live.
    this.accounts.onSummary(async (b) => {
      if (
        b.serviceType !== 'food' ||
        (b.status !== 'approved' && b.status !== 'suspended')
      )
        return {};
      const v = await this.vendors.ensureForBusinessId(b.id);
      const s = await this.setup(v);
      const [row] = await this.dataSource.query(
        `SELECT fb.slug, br.status FROM food_brands fb JOIN branches br ON br.brand_id = fb.id WHERE fb.id = $1`,
        [v.brandId],
      );
      return {
        food: {
          brandId: v.brandId,
          brandSlug: row.slug,
          branchStatus: row.status,
          isLive: row.status === 'active',
          setupComplete: s.ready,
        },
      };
    });
  }

  async setup(v: VendorRef, m: EntityManager = this.dataSource.manager) {
    const items: Array<{
      key: string;
      label: string;
      required: boolean;
      done: boolean;
    }> = [];
    for (const c of this.checks) {
      if (c.subTypes && !c.subTypes.includes(v.subType)) continue;
      const required = c.applies ? await c.applies(m, v) : true;
      items.push({
        key: c.key,
        label: c.label,
        required,
        done: await c.done(m, v),
      });
    }
    const required = items.filter((i) => i.required);
    const done = required.filter((i) => i.done).length;
    const [branch] = await m.query(
      `SELECT status FROM branches WHERE id = $1`,
      [v.branchId],
    );
    return {
      subType: v.subType,
      items,
      percent: required.length
        ? Math.round((done / required.length) * 100)
        : 100,
      missing: required.filter((i) => !i.done).map((i) => i.key),
      ready: done === required.length,
      isLive: branch.status === 'active',
    };
  }

  /** draft → active. 422 PROFILE_INCOMPLETE (details.missing), or FOOD_SAFETY_CHECK_REQUIRED. */
  async goLive(v: VendorRef, now = new Date()) {
    await this.dataSource.transaction(async (m) => {
      const branch = await m.findOne(Branch, {
        where: { id: v.branchId },
        lock: { mode: 'pessimistic_write' },
      });
      if (branch!.status === 'suspended') {
        throw new ForbiddenException({
          code: ErrorCode.FORBIDDEN,
          message: 'MetroMatrix has suspended this branch. Contact support.',
        });
      }
      if (branch!.status === 'active') return;
      const s = await this.setup(v, m);
      const missing = s.missing.filter((k) => k !== 'food_safety');
      if (missing.length) {
        throw new UnprocessableEntityException({
          code: ErrorCode.PROFILE_INCOMPLETE,
          message: 'Finish setting up before going live.',
          details: { missing: s.missing },
        });
      }
      if (s.missing.includes('food_safety')) {
        throw new UnprocessableEntityException({
          code: ErrorCode.FOOD_SAFETY_CHECK_REQUIRED,
          message:
            'Home kitchens go live after MetroMatrix’s food-safety check. We will arrange a test order.',
        });
      }
      await m.update(
        Branch,
        { id: v.branchId },
        { status: 'active', wentLiveAt: now },
      );
    });
    return this.setup(v);
  }

  /** Staff: record a home kitchen's food-safety check (passed sets the date; failed clears it). */
  async foodSafetyCheck(
    adminId: string,
    branchId: string,
    outcome: 'passed' | 'failed',
    note: string,
  ) {
    const branch = await this.dataSource.manager.findOne(Branch, {
      where: { id: branchId },
    });
    if (!branch)
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Branch not found.',
      });
    await this.dataSource.manager.update(
      Branch,
      { id: branchId },
      {
        foodSafetyCheckedAt: outcome === 'passed' ? new Date() : null,
        foodSafetyNote: note,
      },
    );
    await this.audit.record({
      actorUserId: adminId,
      action: 'food.branch.food_safety',
      targetType: 'branch',
      targetId: branchId,
      details: { outcome },
      before: {
        foodSafetyCheckedAt: branch.foodSafetyCheckedAt,
        foodSafetyNote: branch.foodSafetyNote,
      },
      after: {
        foodSafetyCheckedAt: outcome === 'passed' ? new Date() : null,
        foodSafetyNote: note,
      },
    });
    const v = await this.vendors.ensureForBusinessId(branch.businessId);
    return {
      branchId,
      outcome,
      foodSafetyCheckedAt: outcome === 'passed' ? new Date() : null,
      setup: await this.setup(v),
    };
  }
}
