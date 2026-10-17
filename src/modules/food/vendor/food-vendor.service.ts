import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Business } from '../../businesses/entities/business.entity';
import { BusinessesService } from '../../businesses/businesses.service';
import { PlanService } from '../../plans/plans.service';
import { ErrorCode } from '../../../common/errors/codes';
import { reconcileRiderSeats } from '../riders/rider-seats';

export interface VendorRef {
  businessId: string;
  brandId: string;
  branchId: string;
  ownerUserId: string;
  subType: 'restaurant' | 'cloud_kitchen' | 'home_kitchen';
  isHomeKitchen: boolean;
}

export const vendorNotFound = () =>
  new NotFoundException({
    code: ErrorCode.NOT_FOUND,
    message: 'Vendor not found.',
  });

/**
 * The vendor's one brand and one branch. Created when a food business is
 * approved (and on first use for businesses approved before Food existed);
 * there is no endpoint that creates a second of either.
 */
@Injectable()
export class FoodVendorService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly businesses: BusinessesService,
    private readonly plans: PlanService,
  ) {}

  onModuleInit(): void {
    this.businesses.onApproved(async (m, b) => {
      if (b.serviceType === 'food') await this.ensureForBusiness(m, b);
    });
    const count =
      (table: string, extra = '') =>
      async (m: EntityManager, businessId: string) =>
        (
          await m.query(
            `SELECT count(*)::int AS n FROM ${table} WHERE business_id = $1 ${extra}`,
            [businessId],
          )
        )[0].n;
    this.plans.registerCounter('brands', count('food_brands'));
    this.plans.registerCounter('branches', count('branches'));
    this.plans.registerCounter(
      'riders',
      count('riders', `AND status = 'active'`),
    );
    this.plans.onPlanChanged(async (m, businessId, plan) => {
      await reconcileRiderSeats(m, businessId, plan.limits.riders);
    });
  }

  /** Idempotent: brand, branch (draft) and the community plan for a food business. */
  async ensureForBusiness(m: EntityManager, b: Business): Promise<void> {
    await m.query(
      `INSERT INTO food_brands (business_id, name, slug, is_home_kitchen)
       VALUES ($1, $2, $3, $4) ON CONFLICT (business_id) DO NOTHING`,
      [b.id, b.name, b.slug, b.subType === 'home_kitchen'],
    );
    await m.query(
      `INSERT INTO branches (business_id, brand_id, address_line, city, phone, geo, accepts_pickup)
       SELECT $1, fb.id, $2, $3, $4,
              CASE WHEN $5::float8 IS NULL OR $6::float8 IS NULL THEN NULL
                   ELSE ST_SetSRID(ST_MakePoint($6::float8, $5::float8), 4326)::geography END,
              $7
         FROM food_brands fb WHERE fb.business_id = $1
       ON CONFLICT (business_id) DO NOTHING`,
      [
        b.id,
        b.addressLine,
        b.city,
        b.phone,
        b.lat,
        b.lng,
        b.subType !== 'cloud_kitchen',
      ],
    );
    await this.plans.ensure(m, b.id);
  }

  async ensureForBusinessId(
    businessId: string,
    m: EntityManager = this.dataSource.manager,
  ): Promise<VendorRef> {
    let ref = await this.refOf(m, businessId);
    if (!ref) {
      const b = await m.findOneByOrFail(Business, { id: businessId });
      await this.ensureForBusiness(m, b);
      ref = (await this.refOf(m, businessId))!;
    }
    return ref;
  }

  private async refOf(
    m: EntityManager,
    businessId: string,
  ): Promise<VendorRef | null> {
    const [row] = await m.query(
      `SELECT b.id AS business_id, b.owner_user_id, b.sub_type, fb.id AS brand_id, fb.is_home_kitchen, br.id AS branch_id
         FROM businesses b JOIN food_brands fb ON fb.business_id = b.id JOIN branches br ON br.business_id = b.id
        WHERE b.id = $1`,
      [businessId],
    );
    return row
      ? {
          businessId: row.business_id,
          brandId: row.brand_id,
          branchId: row.branch_id,
          ownerUserId: row.owner_user_id,
          subType: row.sub_type,
          isHomeKitchen: row.is_home_kitchen,
        }
      : null;
  }

  /** A vendor by brand id (admin and public routes); 404 otherwise. */
  async byBrandId(
    brandId: string,
    m: EntityManager = this.dataSource.manager,
  ): Promise<VendorRef> {
    const [row] = await m.query(
      `SELECT business_id FROM food_brands WHERE id = $1`,
      [brandId],
    );
    if (!row) throw vendorNotFound();
    return (await this.refOf(m, row.business_id))!;
  }
}
