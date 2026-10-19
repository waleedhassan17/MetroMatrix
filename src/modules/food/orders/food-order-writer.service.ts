import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { newCode } from '../../../common/utils/codes';
import { FoodOrder } from './entities/food-order.entity';
import {
  FoodOrderItem,
  OrderedOption,
} from './entities/food-order-item.entity';
import { FoodOrderEvent } from './entities/food-order-event.entity';
import type { FoodActorRole } from './food-order-status';

export interface OrderLineInput {
  itemId: string | null;
  variantId: string | null;
  itemName: string;
  variantName: string | null;
  options: OrderedOption[];
  unitPrice: number;
  quantity: number;
  notes?: string | null;
  /** Today's portions this line took (home kitchens), given back on cancel. */
  portionsTaken?: number;
}

/**
 * The one way an order row is written: a fresh FC- code (ON CONFLICT DO
 * NOTHING keeps the transaction usable on a collision), the drop point,
 * the lines as sold and the `placed` event. Checkout uses it; so do the
 * orders Chunk 5 writes for tiffin, catering and surplus — so the board,
 * riders and realtime see one kind of order.
 */
@Injectable()
export class FoodOrderWriter {
  async write(
    m: EntityManager,
    values: Partial<FoodOrder>,
    lines: OrderLineInput[],
    placedBy: { role: FoodActorRole; userId: string | null },
    eventData: Record<string, unknown> | null = null,
  ): Promise<FoodOrder> {
    let orderId: string | null = null;
    for (let attempt = 0; attempt < 5 && !orderId; attempt++) {
      const res = await m
        .createQueryBuilder()
        .insert()
        .into(FoodOrder)
        .values({ ...values, status: 'placed', code: newCode('FC') })
        .orIgnore()
        .returning('id')
        .execute();
      if (res.raw.length) orderId = res.raw[0].id;
    }
    if (!orderId)
      throw new Error('Could not allocate an order code after 5 attempts');
    const a = values.addressSnapshot;
    if (a)
      await m.query(
        `UPDATE food_orders SET drop_geo = ST_SetSRID(ST_MakePoint($2::float8, $3::float8), 4326)::geography WHERE id = $1`,
        [orderId, a.lng, a.lat],
      );
    await m.insert(
      FoodOrderItem,
      lines.map((l, i) => ({
        orderId: orderId!,
        lineNo: i + 1,
        itemId: l.itemId,
        variantId: l.variantId,
        itemName: l.itemName,
        variantName: l.variantName,
        options: l.options,
        unitPrice: l.unitPrice,
        quantity: l.quantity,
        lineTotal: l.unitPrice * l.quantity,
        notes: l.notes ?? null,
        portionsTaken: l.portionsTaken ?? 0,
      })),
    );
    await m.save(
      m.create(FoodOrderEvent, {
        orderId,
        kind: 'status',
        from: null,
        to: 'placed',
        actorRole: placedBy.role,
        actorUserId: placedBy.userId,
        note: null,
        data: eventData,
      }),
    );
    return m.findOneByOrFail(FoodOrder, { id: orderId });
  }
}
