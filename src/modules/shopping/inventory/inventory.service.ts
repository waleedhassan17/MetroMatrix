import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  InventoryMovement,
  InventoryReason,
} from './entities/inventory-movement.entity';
import { ErrorCode } from '../../../common/errors/codes';
import { paged } from '../../../common/pagination/pagination';
import {
  LOW_STOCK_THRESHOLD,
  likeEscape,
  SqlParams,
  variantLabel,
} from '../common/catalog-sql';
import { InventoryQueryDto } from './dto/inventory.dto';

export interface StockChange {
  variantId: string;
  /** Relative change… */
  delta?: number;
  /** …or the absolute new level. Exactly one of the two. */
  setTo?: number;
}

export interface MovementRef {
  reason: InventoryReason;
  refType?: string | null;
  refId?: string | null;
  actorUserId?: string | null;
}

const variantNotFound = () =>
  new NotFoundException({
    code: ErrorCode.NOT_FOUND,
    message: 'Variant not found.',
  });

/**
 * The only code that changes stock. Every change locks its variant rows
 * (`FOR UPDATE`, ascending id — a fixed order, so two transactions can never
 * deadlock on each other's rows), applies the change, and writes an
 * inventory_movements row with the resulting balance, in the caller's
 * transaction.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(InventoryMovement)
    private readonly movements: Repository<InventoryMovement>,
  ) {}

  /**
   * Lock the variants (optionally only this store's), apply every change, or
   * none. A variant outside the store answers 404 — never revealing it exists.
   * A change that would go below zero throws `onShortfall(lines)`.
   */
  async apply(
    m: EntityManager,
    changes: StockChange[],
    ref: MovementRef,
    opts: {
      storeId?: string;
      onShortfall?: (
        lines: Array<{
          variantId: string;
          available: number;
          requested: number;
        }>,
      ) => Error;
    } = {},
  ): Promise<Map<string, number>> {
    const ids = changes.map((c) => c.variantId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Each variant may appear only once per update.',
      });
    }
    const sorted = [...ids].sort();
    const params = new SqlParams();
    const rows: Array<{ id: string; stock: number }> = await m.query(
      `SELECT v.id, v.stock
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
        WHERE v.id = ANY(${params.add(sorted)}::uuid[])
          ${opts.storeId ? `AND p.store_id = ${params.add(opts.storeId)}` : ''}
        ORDER BY v.id
        FOR UPDATE OF v`,
      params.values,
    );
    if (rows.length !== ids.length) throw variantNotFound();
    const current = new Map(rows.map((r) => [r.id, r.stock]));

    const next = new Map<string, number>();
    const shortfalls: Array<{
      variantId: string;
      available: number;
      requested: number;
    }> = [];
    for (const c of changes) {
      const have = current.get(c.variantId)!;
      const target = c.setTo !== undefined ? c.setTo : have + (c.delta ?? 0);
      if (target < 0)
        shortfalls.push({
          variantId: c.variantId,
          available: have,
          requested: -(c.delta ?? 0),
        });
      next.set(c.variantId, target);
    }
    if (shortfalls.length) {
      throw (
        opts.onShortfall?.(shortfalls) ??
        new BadRequestException({
          code: ErrorCode.VALIDATION_FAILED,
          message: 'Stock cannot go below zero.',
          details: { lines: shortfalls },
        })
      );
    }

    const movements: Partial<InventoryMovement>[] = [];
    for (const variantId of sorted) {
      const before = current.get(variantId)!;
      const after = next.get(variantId)!;
      if (after === before) continue;
      await m.query(
        `UPDATE product_variants SET stock = $1, updated_at = now() WHERE id = $2`,
        [after, variantId],
      );
      movements.push({
        variantId,
        delta: after - before,
        reason: ref.reason,
        refType: ref.refType ?? null,
        refId: ref.refId ?? null,
        actorUserId: ref.actorUserId ?? null,
        balanceAfter: after,
      });
    }
    if (movements.length) await m.insert(InventoryMovement, movements);
    return next;
  }

  // ── Partner endpoints ─────────────────────────────────────────────────────

  async adjust(
    storeId: string,
    actorUserId: string,
    variantId: string,
    body: { delta?: number; setTo?: number },
  ) {
    if ((body.delta === undefined) === (body.setTo === undefined)) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Send exactly one of delta or setTo.',
      });
    }
    const change: StockChange =
      body.setTo !== undefined
        ? { variantId, setTo: body.setTo }
        : { variantId, delta: body.delta };
    const next = await this.dataSource.transaction((m) =>
      this.apply(
        m,
        [change],
        { reason: 'manual', refType: 'variant', refId: variantId, actorUserId },
        { storeId },
      ),
    );
    return { variantId, stock: next.get(variantId)! };
  }

  /** All rows or none; any foreign variant → 404 (the FYP answered 200 here). */
  async bulk(
    storeId: string,
    actorUserId: string,
    rows: Array<{ variantId: string; setTo: number }>,
  ) {
    const next = await this.dataSource.transaction((m) =>
      this.apply(
        m,
        rows.map((r) => ({ variantId: r.variantId, setTo: r.setTo })),
        { reason: 'bulk', actorUserId },
        { storeId },
      ),
    );
    return {
      updated: rows.length,
      items: rows.map((r) => ({
        variantId: r.variantId,
        stock: next.get(r.variantId)!,
      })),
    };
  }

  async list(storeId: string, q: InventoryQueryDto) {
    const params = new SqlParams();
    const where = [
      `p.store_id = ${params.add(storeId)}`,
      `p.status <> 'removed'`,
    ];
    if (q.lowStock === 'true')
      where.push(`v.is_active AND v.stock <= ${LOW_STOCK_THRESHOLD}`);
    if (q.q) {
      const like = params.add(`%${likeEscape(q.q)}%`);
      where.push(`(p.name ILIKE ${like} OR v.sku ILIKE ${like})`);
    }
    const whereSql = where.join(' AND ');
    const [{ total }] = await this.dataSource.query(
      `SELECT count(*)::int AS total FROM product_variants v JOIN products p ON p.id = v.product_id WHERE ${whereSql}`,
      params.values,
    );
    const rows = await this.dataSource.query(
      `SELECT v.id, v.product_id, p.name AS product_name, v.option1, v.option2, v.sku, v.stock, v.is_active
         FROM product_variants v JOIN products p ON p.id = v.product_id
        WHERE ${whereSql}
        ORDER BY v.stock ASC, p.name ASC, v.id ASC
        LIMIT ${params.add(q.pageSize)} OFFSET ${params.add((q.page - 1) * q.pageSize)}`,
      params.values,
    );
    return paged(
      rows.map((r: any) => ({
        variantId: r.id,
        productId: r.product_id,
        productName: r.product_name,
        label: variantLabel(r),
        sku: r.sku,
        stock: r.stock,
        isActive: r.is_active,
        lowStock: r.is_active && r.stock <= LOW_STOCK_THRESHOLD,
      })),
      total,
      q,
    );
  }

  async movementsOf(
    storeId: string,
    variantId: string,
    page: { page: number; pageSize: number },
  ) {
    const [owned] = await this.dataSource.query(
      `SELECT 1 FROM product_variants v JOIN products p ON p.id = v.product_id
        WHERE v.id = $1 AND p.store_id = $2`,
      [variantId, storeId],
    );
    if (!owned) throw variantNotFound();
    const [rows, total] = await this.movements.findAndCount({
      where: { variantId },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (page.page - 1) * page.pageSize,
      take: page.pageSize,
    });
    return paged(
      rows.map((r) => ({
        id: r.id,
        delta: r.delta,
        reason: r.reason,
        refType: r.refType,
        refId: r.refId,
        actorUserId: r.actorUserId,
        balanceAfter: r.balanceAfter,
        createdAt: r.createdAt,
      })),
      total,
      page,
    );
  }
}
