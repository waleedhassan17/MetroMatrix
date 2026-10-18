import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ErrorCode } from '../../../common/errors/codes';
import { likeEscape, paged } from '../../../common/pagination/pagination';
import { bestMatch, normalizeText } from '../../../common/text/fuzzy';
import { todayIn, addDays } from '../../../common/time/time.util';
import type { VendorRef } from '../../food/vendor/food-vendor.service';
import { KitchenIngredient } from '../entities/kitchen-ingredient.entity';
import {
  IngredientDto,
  IngredientsQueryDto,
  UpdateIngredientDto,
} from '../dto/stock.dto';
import { kitchenNotFound } from '../common/errors';
import { KitchenStockService } from './kitchen-stock.service';
import { KitchenAlertsService } from './kitchen-alerts.service';
import {
  BaseUnit,
  CustomUnit,
  display,
  pricePer,
  round3,
  round4,
  toBase,
  unitsFor,
} from './units';

export interface IngredientRow {
  id: string;
  name: string;
  name_ur: string | null;
  category: string;
  base_unit: BaseUnit;
  custom_units: CustomUnit[];
  par_level: string | null;
  on_hand: string;
  avg_cost: string;
  last_cost: string | null;
  is_active: boolean;
  expiring_qty?: string | null;
  used_in?: number;
}

/** The app's view of an ingredient: base-unit numbers plus the friendly ones. */
export function ingredientView(r: IngredientRow) {
  const onHand = Number(r.on_hand);
  const avg = Number(r.avg_cost);
  const par = r.par_level === null ? null : Number(r.par_level);
  return {
    id: r.id,
    name: r.name,
    nameUr: r.name_ur,
    category: r.category,
    baseUnit: r.base_unit,
    customUnits: r.custom_units,
    units: unitsFor({ baseUnit: r.base_unit, customUnits: r.custom_units }),
    onHand,
    onHandDisplay: display(onHand, r.base_unit),
    parLevel: par,
    belowPar: par !== null && onHand < par,
    negative: onHand < 0,
    avgCost: avg,
    avgPrice: pricePer(avg, r.base_unit),
    lastCost: r.last_cost === null ? null : Number(r.last_cost),
    /** Rupees of stock on the shelf at average cost. */
    value: Math.round(Math.max(onHand, 0) * avg),
    expiringSoon: r.expiring_qty ? Number(r.expiring_qty) : 0,
    isActive: r.is_active,
    ...(r.used_in !== undefined ? { usedInRecipes: r.used_in } : {}),
  };
}

export const INGREDIENT_COLUMNS = `ki.id, ki.name, ki.name_ur, ki.category, ki.base_unit, ki.custom_units, ki.par_level,
  ki.on_hand, ki.avg_cost, ki.last_cost, ki.is_active`;

/** Batches expiring within 3 days of the branch's today (qty still on the shelf). */
export const EXPIRING_SQL = (
  dateParam: string,
) => `(SELECT sum(sb.qty_remaining) FROM stock_batches sb
  WHERE sb.ingredient_id = ki.id AND sb.qty_remaining > 0 AND sb.expires_on IS NOT NULL
    AND sb.expires_on <= ${dateParam}::date + 3) AS expiring_qty`;

/**
 * A kitchen's ingredients. Names are unique per kitchen regardless of case
 * (citext). Opening stock goes through KitchenStockService like everything
 * else. Spoken or scanned names resolve here: the kitchen's own names (and
 * Urdu names) first, then ingredient_aliases ("tamatar" → tomato).
 */
@Injectable()
export class IngredientsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly stock: KitchenStockService,
    private readonly alerts: KitchenAlertsService,
  ) {}

  async today(m: EntityManager, branchId: string): Promise<string> {
    const [b] = await m.query(`SELECT timezone FROM branches WHERE id = $1`, [
      branchId,
    ]);
    return todayIn(b.timezone);
  }

  async list(v: VendorRef, q: IngredientsQueryDto) {
    const where = ['ki.branch_id = $1'];
    const params: unknown[] = [v.branchId];
    if ((q.active ?? 'true') !== 'all')
      where.push(`ki.is_active = ${q.active === 'false' ? 'false' : 'true'}`);
    if (q.category) {
      params.push(q.category);
      where.push(`ki.category = $${params.length}`);
    }
    if (q.q) {
      params.push(`%${likeEscape(q.q)}%`);
      where.push(
        `(ki.name ILIKE $${params.length} OR ki.name_ur ILIKE $${params.length})`,
      );
    }
    const today = await this.today(this.dataSource.manager, v.branchId);
    params.push(today);
    const dateP = `$${params.length}`;
    const [{ n }] = await this.dataSource.query(
      `SELECT count(*)::int AS n FROM kitchen_ingredients ki WHERE ${where.join(' AND ')}`,
      params.slice(0, -1),
    );
    const rows = await this.dataSource.query(
      `SELECT ${INGREDIENT_COLUMNS}, ${EXPIRING_SQL(dateP)},
              (SELECT count(*)::int FROM recipe_lines rl WHERE rl.ingredient_id = ki.id) AS used_in
         FROM kitchen_ingredients ki WHERE ${where.join(' AND ')}
        ORDER BY ki.category, ki.name LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`,
      params,
    );
    return paged(rows.map(ingredientView), n, q);
  }

  async get(
    v: VendorRef,
    id: string,
    m: EntityManager = this.dataSource.manager,
  ) {
    const today = await this.today(m, v.branchId);
    const [r] = await m.query(
      `SELECT ${INGREDIENT_COLUMNS}, ${EXPIRING_SQL('$3')},
              (SELECT count(*)::int FROM recipe_lines rl WHERE rl.ingredient_id = ki.id) AS used_in
         FROM kitchen_ingredients ki WHERE ki.id = $1 AND ki.branch_id = $2`,
      [id, v.branchId, today],
    );
    if (!r) throw kitchenNotFound('Ingredient');
    return ingredientView(r);
  }

  /** The locked entity, scoped to the kitchen. */
  async owned(
    m: EntityManager,
    v: VendorRef,
    id: string,
  ): Promise<KitchenIngredient> {
    const i = await m.findOne(KitchenIngredient, {
      where: { id, branchId: v.branchId },
    });
    if (!i) throw kitchenNotFound('Ingredient');
    return i;
  }

  async create(v: VendorRef, dto: IngredientDto) {
    const units = this.checkUnits(dto.customUnits ?? [], dto.baseUnit);
    const owner = { baseUnit: dto.baseUnit, customUnits: units };
    const id = await this.dataSource.transaction(async (m) => {
      const [dup] = await m.query(
        `SELECT id FROM kitchen_ingredients WHERE branch_id = $1 AND name = $2`,
        [v.branchId, dto.name],
      );
      if (dup) throw this.duplicate(dto.name);
      const i = await m.save(
        m.create(KitchenIngredient, {
          branchId: v.branchId,
          name: dto.name,
          nameUr: dto.nameUr ?? null,
          category: dto.category,
          baseUnit: dto.baseUnit,
          customUnits: units,
          parLevel: dto.parLevel
            ? toBase(dto.parLevel.qty, dto.parLevel.unit, owner)
            : null,
        }),
      );
      const o = dto.openingStock;
      if (o && o.qty > 0) {
        const qty = toBase(o.qty, o.unit, owner);
        await this.stock.apply(
          m,
          v.branchId,
          [
            {
              ingredientId: i.id,
              delta: qty,
              unitCost:
                o.totalCost !== undefined ? round4(o.totalCost / qty) : 0,
              expiresOn: o.expiresOn ?? null,
              note: 'Opening stock',
            },
          ],
          'manual',
          { type: 'manual', id: null },
          v.ownerUserId,
        );
      }
      return i.id;
    });
    await this.alerts.flush(v.branchId);
    return this.get(v, id);
  }

  async update(v: VendorRef, id: string, dto: UpdateIngredientDto) {
    await this.dataSource.transaction(async (m) => {
      const i = await this.owned(m, v, id);
      if (dto.name && dto.name.toLowerCase() !== i.name.toLowerCase()) {
        const [dup] = await m.query(
          `SELECT id FROM kitchen_ingredients WHERE branch_id = $1 AND name = $2 AND id <> $3`,
          [v.branchId, dto.name, id],
        );
        if (dup) throw this.duplicate(dto.name);
      }
      const baseUnit = dto.baseUnit ?? i.baseUnit;
      if (baseUnit !== i.baseUnit) {
        const [{ n }] = await m.query(
          `SELECT (SELECT count(*) FROM stock_movements WHERE ingredient_id = $1)
                + (SELECT count(*) FROM recipe_lines WHERE ingredient_id = $1) AS n`,
          [id],
        );
        if (Number(n) > 0)
          throw new BadRequestException({
            code: ErrorCode.VALIDATION_FAILED,
            message:
              'The base unit can’t change once stock has moved or a recipe uses it.',
            details: {
              fields: {
                baseUnit: ['locked once stock has moved or a recipe uses it'],
              },
            },
          });
      }
      const units = dto.customUnits
        ? this.checkUnits(dto.customUnits, baseUnit)
        : i.customUnits;
      const owner = { baseUnit, customUnits: units };
      await m.update(
        KitchenIngredient,
        { id },
        {
          name: dto.name ?? i.name,
          nameUr: dto.nameUr !== undefined ? dto.nameUr : i.nameUr,
          category: dto.category ?? i.category,
          baseUnit,
          customUnits: units,
          parLevel:
            dto.parLevel === undefined
              ? i.parLevel
              : dto.parLevel === null
                ? null
                : toBase(dto.parLevel.qty, dto.parLevel.unit, owner),
          isActive: dto.isActive ?? i.isActive,
        },
      );
    });
    return this.get(v, id);
  }

  /** Deleted when nothing refers to it; otherwise switched off (history and recipes keep it). */
  async remove(v: VendorRef, id: string) {
    return this.dataSource.transaction(async (m) => {
      await this.owned(m, v, id);
      const [{ moves, lines }] = await m.query(
        `SELECT (SELECT count(*)::int FROM stock_movements WHERE ingredient_id = $1) AS moves,
                (SELECT count(*)::int FROM recipe_lines WHERE ingredient_id = $1) AS lines`,
        [id],
      );
      if (moves === 0 && lines === 0) {
        await m.delete(KitchenIngredient, { id });
        return { removed: true };
      }
      await m.update(KitchenIngredient, { id }, { isActive: false });
      return { removed: false, deactivated: true, usedInRecipes: lines };
    });
  }

  /**
   * A spoken / scanned name → one of the kitchen's ingredients: its own
   * names first, then the alias table ("tamatar" → "tomato" → the kitchen's
   * "Tomato"). Ambiguous → candidates; none → the canonical name to offer
   * as a new ingredient.
   */
  async resolve(
    branchId: string,
    spoken: string,
    m: EntityManager = this.dataSource.manager,
  ) {
    const mine: Array<{
      id: string;
      name: string;
      name_ur: string | null;
      base_unit: BaseUnit;
      custom_units: CustomUnit[];
    }> = await m.query(
      `SELECT id, name, name_ur, base_unit, custom_units FROM kitchen_ingredients WHERE branch_id = $1 AND is_active`,
      [branchId],
    );
    const words = normalizeText(spoken);
    const aliasRows: Array<{ alias: string; canonical: string }> =
      await m.query(
        `SELECT alias::text, canonical FROM ingredient_aliases WHERE alias = ANY($1::citext[])`,
        [
          [
            words,
            ...words.split(' '),
            ...mine.map((i) => normalizeText(i.name)),
          ],
        ],
      );
    const canon = new Map(
      aliasRows.map((a) => [normalizeText(a.alias), a.canonical]),
    );
    const spokenCanon =
      canon.get(words) ??
      words
        .split(' ')
        .map((w) => canon.get(w))
        .find(Boolean) ??
      null;
    const candidates = mine.map((i) => ({
      value: i,
      names: [
        i.name,
        ...(i.name_ur ? [i.name_ur] : []),
        ...(canon.get(normalizeText(i.name))
          ? [canon.get(normalizeText(i.name))!]
          : []),
      ],
    }));
    const direct = bestMatch(spoken, candidates, 0.5);
    if (direct.best && direct.best.score >= 0.75)
      return {
        ingredient: direct.best.value,
        candidates: [],
        canonical: spokenCanon,
      };
    if (spokenCanon) {
      const viaAlias = bestMatch(spokenCanon, candidates, 0.6);
      if (viaAlias.best && viaAlias.best.score >= 0.75)
        return {
          ingredient: viaAlias.best.value,
          candidates: [],
          canonical: spokenCanon,
        };
    }
    const options = [direct.best, ...direct.others].filter(Boolean) as Array<{
      value: (typeof mine)[number];
      score: number;
    }>;
    return { ingredient: null, candidates: options, canonical: spokenCanon };
  }

  /** "5 kilo" for this ingredient → base units, or null when the unit doesn't fit. */
  safeBase(
    i: { base_unit: BaseUnit; custom_units: CustomUnit[] },
    qty: number | undefined,
    unit: string | undefined,
  ): number | null {
    if (qty === undefined) return null;
    try {
      return toBase(qty, unit ?? i.base_unit, {
        baseUnit: i.base_unit,
        customUnits: i.custom_units,
      });
    } catch {
      return null;
    }
  }

  private checkUnits(units: CustomUnit[], base: BaseUnit): CustomUnit[] {
    const reserved = new Set(['g', 'kg', 'ml', 'l', 'piece', 'dozen']);
    const names = new Set<string>();
    for (const u of units) {
      if (reserved.has(u.name) || names.has(u.name))
        throw new BadRequestException({
          code: ErrorCode.VALIDATION_FAILED,
          message: `“${u.name}” is a standard unit or listed twice.`,
          details: {
            fields: { customUnits: [`${u.name}: standard or duplicate`] },
          },
        });
      names.add(u.name);
    }
    void base;
    return units.map((u) => ({ name: u.name, factor: round3(u.factor) }));
  }

  private duplicate(name: string) {
    return new ConflictException({
      code: ErrorCode.CONFLICT,
      message: `You already have an ingredient called “${name}”.`,
      details: { name },
    });
  }

  /** Base-unit quantity plus N days → a date in the branch's calendar. */
  static expiryFrom(today: string, days?: number): string | null {
    return days === undefined ? null : addDays(today, days);
  }
}
