import { ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DataSource, EntityManager } from 'typeorm';
import { ErrorCode } from '../../../common/errors/codes';
import type { VendorRef } from '../../food/vendor/food-vendor.service';
import type { RiderRef } from '../../food/common/rider.guard';
import { FoodOrderTransitionsService } from '../../food/orders/food-order-transitions.service';
import { FoodOrderViewsService } from '../../food/orders/food-order-views.service';
import { MediaService } from '../../media/media.service';
import { AiService } from '../../ai/ai.service';
import { PackingProofDto } from '../dto/surplus.dto';
import { kitchenNotFound } from '../common/errors';

class DetectedItem {
  @IsString() @Length(1, 80) name!: string;
  @IsInt() @Min(0) @Max(200) count!: number;
}

export class PackingAnswerDto {
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => DetectedItem)
  detectedItems!: DetectedItem[];
  @IsBoolean() match!: boolean;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  missing?: string[];
  @IsNumber() @Min(0) @Max(1) confidence!: number;
  @IsOptional() @IsString() @MaxLength(240) note?: string;
}

const PACKING_SCHEMA = {
  type: 'object',
  properties: {
    detectedItems: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, count: { type: 'integer' } },
        required: ['name', 'count'],
      },
    },
    match: { type: 'boolean' },
    missing: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number' },
    note: { type: 'string' },
  },
  required: ['detectedItems', 'match', 'confidence'],
};

/** Orders may have a photo of the packed food before they leave. */
const OPEN_FOR_PROOF = ['accepted', 'preparing', 'ready'];

/**
 * Packing proof: a photo of the packed order (vendor, or the rider at
 * pickup). With require_packing_photo on, handing over (on_the_way /
 * picked_up) without one is 409 PACKING_PHOTO_REQUIRED. The AI item check
 * (feature packing_check) is advisory: it never blocks.
 */
@Injectable()
export class PackingService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly transitions: FoodOrderTransitionsService,
    private readonly views: FoodOrderViewsService,
    private readonly media: MediaService,
    private readonly ai: AiService,
  ) {}

  onModuleInit(): void {
    this.transitions.beforeStatus.push(async (m, order, _from, to) => {
      if (to !== 'on_the_way' && to !== 'picked_up') return;
      const [b] = await m.query(
        `SELECT require_packing_photo FROM branches WHERE id = $1`,
        [order.branchId],
      );
      if (!b?.require_packing_photo) return;
      const [p] = await m.query(
        `SELECT 1 FROM packing_proofs WHERE order_id = $1`,
        [order.id],
      );
      if (!p)
        throw new ConflictException({
          code: ErrorCode.PACKING_PHOTO_REQUIRED,
          message: 'Take a photo of the packed order first.',
          details: { orderId: order.id },
        });
    });
    this.views.packingPhoto = async (order) => {
      const [p] = await this.dataSource.query(
        `SELECT photo_url FROM packing_proofs WHERE order_id = $1`,
        [order.id],
      );
      return p?.photo_url ?? null;
    };
  }

  async vendorUpload(v: VendorRef, orderId: string, dto: PackingProofDto) {
    this.media.assertOwnedAsset(
      v.ownerUserId,
      'packing_proof',
      dto.photoUrl,
      dto.publicId,
      'photoUrl',
    );
    const [o] = await this.dataSource.query(
      `SELECT id, status FROM food_orders WHERE id = $1 AND branch_id = $2`,
      [orderId, v.branchId],
    );
    if (!o) throw kitchenNotFound('Order');
    return this.save(o, dto.photoUrl, 'vendor', v.ownerUserId, {
      businessId: v.businessId,
      userId: v.ownerUserId,
    });
  }

  async riderUpload(r: RiderRef, orderId: string, dto: PackingProofDto) {
    this.media.assertOwnedAsset(
      r.userId,
      'packing_proof',
      dto.photoUrl,
      dto.publicId,
      'photoUrl',
    );
    const [o] = await this.dataSource.query(
      `SELECT id, status FROM food_orders WHERE id = $1 AND rider_id = $2`,
      [orderId, r.id],
    );
    if (!o) throw kitchenNotFound('Order');
    return this.save(o, dto.photoUrl, 'rider', r.userId, {
      businessId: r.businessId,
      userId: r.userId,
    });
  }

  private async save(
    o: { id: string; status: string },
    photoUrl: string,
    by: 'vendor' | 'rider',
    userId: string,
    actor: { businessId: string; userId: string },
  ) {
    if (!OPEN_FOR_PROOF.includes(o.status))
      throw new ConflictException({
        code: ErrorCode.INVALID_TRANSITION,
        message: `This order is ${o.status.replace('_', ' ')}: the packing photo is taken before it leaves.`,
      });
    const aiCheck = await this.check(
      this.dataSource.manager,
      o.id,
      photoUrl,
      actor,
    );
    await this.dataSource.query(
      `INSERT INTO packing_proofs (order_id, photo_url, taken_by, taken_by_user_id, ai_check) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (order_id) DO UPDATE SET photo_url = EXCLUDED.photo_url, taken_by = EXCLUDED.taken_by,
         taken_by_user_id = EXCLUDED.taken_by_user_id, ai_check = EXCLUDED.ai_check, updated_at = now()`,
      [o.id, photoUrl, by, userId, aiCheck ? JSON.stringify(aiCheck) : null],
    );
    return { orderId: o.id, photoUrl, takenBy: by, aiCheck };
  }

  /** The advisory check, when the feature is on; any failure is just "no check". */
  private async check(
    m: EntityManager,
    orderId: string,
    photoUrl: string,
    actor: { businessId: string; userId: string },
  ) {
    if (!this.ai.usable('packing_check')) return null;
    const expected: Array<{ name: string; quantity: number }> = await m.query(
      `SELECT item_name || coalesce(' (' || variant_name || ')', '') AS name, quantity FROM food_order_items WHERE order_id = $1`,
      [orderId],
    );
    const out = await this.ai.vision({
      feature: 'packing_check',
      promptId: 'packing_check',
      input: { expectedItems: expected },
      imageUrls: [photoUrl],
      schema: PACKING_SCHEMA,
      dto: PackingAnswerDto,
      actor,
      temperature: 0,
    });
    if (!out.ok) return null;
    return {
      expectedItems: expected,
      detectedItems: out.data.detectedItems,
      match: out.data.match,
      missing: out.data.missing ?? [],
      confidence: out.data.confidence,
      note: out.data.note ?? null,
      advisory: true,
    };
  }
}
