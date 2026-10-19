import { ConflictException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ErrorCode } from '../../../common/errors/codes';
import { paged } from '../../../common/pagination/pagination';
import type { VendorRef } from '../../food/vendor/food-vendor.service';
import { MediaService } from '../../media/media.service';
import { Purchase, PurchaseLine } from '../entities/purchase.entity';
import { Supplier } from '../entities/supplier.entity';
import {
  PurchaseDto,
  PurchasesQueryDto,
  SupplierDto,
  UpdatePurchaseDto,
  UpdateSupplierDto,
} from '../dto/purchase.dto';
import { kitchenNotFound } from '../common/errors';
import { KitchenStockService } from '../stock/kitchen-stock.service';
import { KitchenAlertsService } from '../stock/kitchen-alerts.service';
import { CostingService } from '../costing/costing.service';
import { display, round4, toBase } from '../stock/units';

/**
 * Suppliers and purchases. A purchase line becomes a batch, a purchase
 * movement and a new weighted average cost (KitchenStockService). After it,
 * any dish the new costs push above the vendor's food cost target gets an
 * alert. A purchase can be deleted only while none of it has been used.
 */
@Injectable()
export class PurchasesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly stock: KitchenStockService,
    private readonly alerts: KitchenAlertsService,
    private readonly costing: CostingService,
    private readonly media: MediaService,
  ) {}

  // ── suppliers ──
  async suppliers(v: VendorRef) {
    const rows = await this.dataSource.query(
      `SELECT s.id, s.name, s.phone, s.notes, s.is_active,
              (SELECT max(p.purchased_at) FROM purchases p WHERE p.supplier_id = s.id) AS last_purchase_at,
              (SELECT coalesce(sum(p.total), 0)::int FROM purchases p
                WHERE p.supplier_id = s.id AND p.purchased_at > now() - interval '30 days') AS spent_30d
         FROM suppliers s WHERE s.branch_id = $1 ORDER BY s.is_active DESC, s.name`,
      [v.branchId],
    );
    return rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      notes: r.notes,
      isActive: r.is_active,
      lastPurchaseAt: r.last_purchase_at,
      spent30d: r.spent_30d,
    }));
  }

  async createSupplier(v: VendorRef, dto: SupplierDto) {
    const [dup] = await this.dataSource.query(
      `SELECT id FROM suppliers WHERE branch_id = $1 AND name = $2`,
      [v.branchId, dto.name],
    );
    if (dup) throw this.dupSupplier(dto.name);
    const s = await this.dataSource.manager.save(
      this.dataSource.manager.create(Supplier, {
        branchId: v.branchId,
        name: dto.name,
        phone: dto.phone ?? null,
        notes: dto.notes ?? null,
      }),
    );
    return {
      id: s.id,
      name: s.name,
      phone: s.phone,
      notes: s.notes,
      isActive: s.isActive,
    };
  }

  async updateSupplier(v: VendorRef, id: string, dto: UpdateSupplierDto) {
    const s = await this.dataSource.manager.findOne(Supplier, {
      where: { id, branchId: v.branchId },
    });
    if (!s) throw kitchenNotFound('Supplier');
    if (dto.name && dto.name.toLowerCase() !== s.name.toLowerCase()) {
      const [dup] = await this.dataSource.query(
        `SELECT id FROM suppliers WHERE branch_id = $1 AND name = $2 AND id <> $3`,
        [v.branchId, dto.name, id],
      );
      if (dup) throw this.dupSupplier(dto.name);
    }
    await this.dataSource.manager.update(
      Supplier,
      { id },
      {
        name: dto.name ?? s.name,
        phone: dto.phone !== undefined ? dto.phone : s.phone,
        notes: dto.notes !== undefined ? dto.notes : s.notes,
        isActive: dto.isActive ?? s.isActive,
      },
    );
    return (await this.suppliers(v)).find((x: { id: string }) => x.id === id);
  }

  /** Deleted; its purchases keep their history without a supplier. */
  async removeSupplier(v: VendorRef, id: string) {
    const res = await this.dataSource.manager.delete(Supplier, {
      id,
      branchId: v.branchId,
    });
    if (!res.affected) throw kitchenNotFound('Supplier');
    return { removed: true };
  }

  // ── purchases ──
  async create(v: VendorRef, dto: PurchaseDto) {
    if (dto.receiptUrl)
      this.media.assertOwnedAsset(
        v.ownerUserId,
        'receipt',
        dto.receiptUrl,
        dto.receiptPublicId,
        'receiptUrl',
      );
    const id = await this.dataSource.transaction(async (m) => {
      if (dto.supplierId) {
        const [s] = await m.query(
          `SELECT id FROM suppliers WHERE id = $1 AND branch_id = $2`,
          [dto.supplierId, v.branchId],
        );
        if (!s) throw kitchenNotFound('Supplier');
      }
      const ids = [...new Set(dto.lines.map((l) => l.ingredientId))];
      const ings: Array<{
        id: string;
        base_unit: 'g' | 'ml' | 'piece';
        custom_units: [];
      }> = await m.query(
        `SELECT id, base_unit, custom_units FROM kitchen_ingredients WHERE branch_id = $1 AND id = ANY($2::uuid[])`,
        [v.branchId, ids],
      );
      if (ings.length !== ids.length) throw kitchenNotFound('Ingredient');
      const lines = dto.lines.map((l) => {
        const ing = ings.find((x) => x.id === l.ingredientId)!;
        const qtyBase = toBase(l.qty, l.unit, {
          baseUnit: ing.base_unit,
          customUnits: ing.custom_units,
        });
        return { ...l, qtyBase, unitCost: round4(l.totalPrice / qtyBase) };
      });
      const before = await this.costing.rows(m, v);
      const p = await m.save(
        m.create(Purchase, {
          branchId: v.branchId,
          supplierId: dto.supplierId ?? null,
          purchasedAt: dto.purchasedAt ? new Date(dto.purchasedAt) : new Date(),
          total: lines.reduce((s, l) => s + l.totalPrice, 0),
          receiptUrl: dto.receiptUrl ?? null,
          source: dto.source ?? 'manual',
          note: dto.note ?? null,
          createdBy: v.ownerUserId,
        }),
      );
      const saved = await m.save(
        lines.map((l) =>
          m.create(PurchaseLine, {
            purchaseId: p.id,
            ingredientId: l.ingredientId,
            qty: l.qty,
            unit: l.unit,
            qtyBase: l.qtyBase,
            totalPrice: l.totalPrice,
            unitCost: l.unitCost,
            expiresOn: l.expiresOn ?? null,
          }),
        ),
      );
      await this.stock.apply(
        m,
        v.branchId,
        saved.map((l) => ({
          ingredientId: l.ingredientId,
          delta: l.qtyBase,
          unitCost: l.unitCost,
          expiresOn: l.expiresOn,
          purchaseLineId: l.id,
        })),
        'purchase',
        { type: 'purchase', id: p.id },
        v.ownerUserId,
      );
      await m.query(
        `UPDATE purchase_lines pl SET batch_id = sb.id FROM stock_batches sb
          WHERE sb.purchase_line_id = pl.id AND pl.purchase_id = $1`,
        [p.id],
      );
      await this.costAlerts(m, v, before);
      return p.id;
    });
    await this.alerts.flush(v.branchId);
    return this.get(v, id);
  }

  /** Dishes the new costs pushed over the target (they weren't before). */
  private async costAlerts(
    m: EntityManager,
    v: VendorRef,
    before: Awaited<ReturnType<CostingService['rows']>>,
  ) {
    const after = await this.costing.rows(m, v);
    const { target } = await this.costing.target(m, v.branchId);
    for (const a of after) {
      const b = before.find(
        (x) => x.itemId === a.itemId && x.variantId === a.variantId,
      );
      if (!a.aboveTarget || (b && b.aboveTarget) || a.foodCostPct === null)
        continue;
      await this.alerts.queue(
        m,
        v.branchId,
        'food_cost_high',
        `${a.name}${a.variantName ? ` (${a.variantName})` : ''} now costs ${a.foodCostPct}% of its price`,
        `Above your ${target}% target after today's prices: Rs ${Math.round(a.cost!)} a plate for Rs ${a.price}. Review the price or the recipe.`,
        { itemId: a.itemId, variantId: a.variantId, screen: 'kitchen.costing' },
      );
    }
  }

  async list(v: VendorRef, q: PurchasesQueryDto) {
    const where = ['p.branch_id = $1'];
    const params: unknown[] = [v.branchId];
    if (q.supplierId) {
      params.push(q.supplierId);
      where.push(`p.supplier_id = $${params.length}`);
    }
    if (q.ingredientId) {
      params.push(q.ingredientId);
      where.push(
        `EXISTS (SELECT 1 FROM purchase_lines x WHERE x.purchase_id = p.id AND x.ingredient_id = $${params.length})`,
      );
    }
    if (q.from) {
      params.push(q.from);
      where.push(`p.purchased_at >= $${params.length}::date`);
    }
    if (q.to) {
      params.push(q.to);
      where.push(`p.purchased_at < $${params.length}::date + 1`);
    }
    const [{ n }] = await this.dataSource.query(
      `SELECT count(*)::int AS n FROM purchases p WHERE ${where.join(' AND ')}`,
      params,
    );
    const rows = await this.dataSource.query(
      `SELECT p.id, p.purchased_at, p.total, p.source, p.note, p.receipt_url, s.name AS supplier,
              (SELECT count(*)::int FROM purchase_lines pl WHERE pl.purchase_id = p.id) AS lines
         FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
        WHERE ${where.join(' AND ')} ORDER BY p.purchased_at DESC, p.id
        LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`,
      params,
    );
    return paged(
      rows.map((r: any) => ({
        id: r.id,
        purchasedAt: r.purchased_at,
        total: r.total,
        source: r.source,
        note: r.note,
        hasReceipt: !!r.receipt_url,
        supplier: r.supplier,
        lines: r.lines,
      })),
      n,
      q,
    );
  }

  async get(v: VendorRef, id: string) {
    const [p] = await this.dataSource.query(
      `SELECT p.*, s.name AS supplier_name FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
        WHERE p.id = $1 AND p.branch_id = $2`,
      [id, v.branchId],
    );
    if (!p) throw kitchenNotFound('Purchase');
    const lines = await this.dataSource.query(
      `SELECT pl.id, pl.ingredient_id, ki.name, ki.base_unit, pl.qty, pl.unit, pl.qty_base, pl.total_price,
              pl.unit_cost, pl.expires_on, pl.batch_id, sb.qty_remaining
         FROM purchase_lines pl JOIN kitchen_ingredients ki ON ki.id = pl.ingredient_id
         LEFT JOIN stock_batches sb ON sb.id = pl.batch_id
        WHERE pl.purchase_id = $1 ORDER BY pl.created_at, pl.id`,
      [id],
    );
    return {
      id: p.id,
      purchasedAt: p.purchased_at,
      total: p.total,
      source: p.source,
      note: p.note,
      supplier: p.supplier_id
        ? { id: p.supplier_id, name: p.supplier_name }
        : null,
      receiptUrl: p.receipt_url,
      receiptDownload: p.receipt_url
        ? this.media.privateDownload(p.receipt_url)
        : null,
      lines: lines.map((l: any) => ({
        id: l.id,
        ingredientId: l.ingredient_id,
        name: l.name,
        qty: Number(l.qty),
        unit: l.unit,
        qtyBase: Number(l.qty_base),
        display: display(Number(l.qty_base), l.base_unit),
        totalPrice: l.total_price,
        unitCost: Number(l.unit_cost),
        expiresOn: l.expires_on,
        remaining: l.qty_remaining === null ? null : Number(l.qty_remaining),
      })),
    };
  }

  async update(v: VendorRef, id: string, dto: UpdatePurchaseDto) {
    const p = await this.dataSource.manager.findOne(Purchase, {
      where: { id, branchId: v.branchId },
    });
    if (!p) throw kitchenNotFound('Purchase');
    if (dto.supplierId) {
      const [s] = await this.dataSource.query(
        `SELECT id FROM suppliers WHERE id = $1 AND branch_id = $2`,
        [dto.supplierId, v.branchId],
      );
      if (!s) throw kitchenNotFound('Supplier');
    }
    await this.dataSource.manager.update(
      Purchase,
      { id },
      {
        supplierId:
          dto.supplierId !== undefined ? dto.supplierId : p.supplierId,
        purchasedAt: dto.purchasedAt
          ? new Date(dto.purchasedAt)
          : p.purchasedAt,
        note: dto.note !== undefined ? dto.note : p.note,
      },
    );
    return this.get(v, id);
  }

  /** Undo a purchase entered by mistake — only while none of it has been used. */
  async remove(v: VendorRef, id: string) {
    await this.dataSource.transaction(async (m) => {
      const [p] = await m.query(
        `SELECT id FROM purchases WHERE id = $1 AND branch_id = $2 FOR UPDATE`,
        [id, v.branchId],
      );
      if (!p) throw kitchenNotFound('Purchase');
      const [{ used }] = await m.query(
        `SELECT count(*)::int AS used FROM purchase_lines pl JOIN stock_batches sb ON sb.id = pl.batch_id
          WHERE pl.purchase_id = $1 AND sb.qty_remaining < sb.qty_received`,
        [id],
      );
      const [{ settled }] = await m.query(
        `SELECT count(*)::int AS settled FROM purchase_lines pl
          WHERE pl.purchase_id = $1 AND (pl.batch_id IS NULL OR
            (SELECT qty_remaining FROM stock_batches WHERE id = pl.batch_id) < pl.qty_base)`,
        [id],
      );
      if (used || settled)
        throw new ConflictException({
          code: ErrorCode.CONFLICT,
          message:
            'Some of this purchase has already been used. Log a stock count instead.',
        });
      await this.stock.reversePurchase(m, v.branchId, id, v.ownerUserId);
      await m.query(`DELETE FROM purchases WHERE id = $1`, [id]);
    });
    await this.alerts.flush(v.branchId);
    return { removed: true };
  }

  private dupSupplier(name: string) {
    return new ConflictException({
      code: ErrorCode.CONFLICT,
      message: `You already have a supplier called “${name}”.`,
      details: { name },
    });
  }
}
