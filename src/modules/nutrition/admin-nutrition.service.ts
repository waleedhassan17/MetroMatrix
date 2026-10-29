import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ErrorCode } from '../../common/errors/codes';
import { OperationalAuditService } from '../../common/audit/operational-audit.service';
import { paged } from '../../common/pagination/pagination';
import { parseCsv } from '../kitchen/costing/spi-csv';
import { NutritionFood } from './entities/nutrition-food.entity';
import { foodView } from './nutrition-mapping.service';
import {
  AdminFoodsQueryDto,
  NutritionFoodDto,
  UpdateNutritionFoodDto,
} from './dto/admin-nutrition.dto';

export const FOODS_CSV_HEADER = [
  'key',
  'name',
  'name_ur',
  'food_group',
  'kcal',
  'protein_g',
  'carbs_g',
  'fat_g',
  'fibre_g',
  'sodium_mg',
  'piece_grams',
];

const notFound = () =>
  new NotFoundException({
    code: ErrorCode.NOT_FOUND,
    message: 'Nutrition food not found.',
  });

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

/**
 * Staff upkeep of the nutrition reference table: search (inactive too),
 * add, edit (an edited USDA row becomes `staff`, its USDA id kept),
 * deactivate (never delete: mappings point at it) and a CSV import keyed by
 * `key`. Every write is audited.
 */
@Injectable()
export class AdminNutritionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: OperationalAuditService,
  ) {}

  private repo() {
    return this.dataSource.getRepository(NutritionFood);
  }

  async list(q: AdminFoodsQueryDto) {
    const qb = this.repo().createQueryBuilder('f');
    if (q.q)
      qb.where(
        '(f.name ILIKE :like OR f.key ILIKE :like OR :q = ANY(f.canonicals))',
        {
          like: `%${q.q.replace(/[%_\\]/g, '\\$&')}%`,
          q: q.q.toLowerCase(),
        },
      );
    if (q.source) qb.andWhere('f.source = :s', { s: q.source });
    if (q.active !== undefined)
      qb.andWhere('f.is_active = :a', { a: q.active === 'true' });
    const [rows, total] = await qb
      .orderBy('f.name', 'ASC')
      .skip((q.page - 1) * q.pageSize)
      .take(q.pageSize)
      .getManyAndCount();
    return paged(
      rows.map((f) => ({
        ...foodView(f),
        isActive: f.isActive,
        canonicals: f.canonicals,
      })),
      total,
      q,
    );
  }

  private async own(id: string) {
    const f = await this.repo().findOne({ where: { id } });
    if (!f) throw notFound();
    return f;
  }

  private values(dto: NutritionFoodDto | UpdateNutritionFoodDto) {
    return {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.nameUr !== undefined ? { nameUr: dto.nameUr } : {}),
      ...(dto.foodGroup !== undefined ? { foodGroup: dto.foodGroup } : {}),
      ...(dto.kcal !== undefined ? { kcal: dto.kcal } : {}),
      ...(dto.proteinG !== undefined ? { proteinG: dto.proteinG } : {}),
      ...(dto.carbsG !== undefined ? { carbsG: dto.carbsG } : {}),
      ...(dto.fatG !== undefined ? { fatG: dto.fatG } : {}),
      ...(dto.fibreG !== undefined ? { fibreG: dto.fibreG } : {}),
      ...(dto.sodiumMg !== undefined ? { sodiumMg: dto.sodiumMg } : {}),
      ...(dto.pieceGrams !== undefined ? { pieceGrams: dto.pieceGrams } : {}),
      ...(dto.canonicals !== undefined
        ? { canonicals: dto.canonicals.map((c) => c.toLowerCase()) }
        : {}),
      ...(dto.note !== undefined ? { note: dto.note } : {}),
    };
  }

  /** The macros can't weigh more than the food: protein + carbs + fat ≤ 100 g per 100 g. */
  private checkMacros(f: { proteinG: number; carbsG: number; fatG: number }) {
    if (f.proteinG + f.carbsG + f.fatG > 100.5)
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message:
          'Protein, carbohydrate and fat add up to more than 100 g per 100 g.',
        details: { fields: { proteinG: ['Too much for 100 g.'] } },
      });
  }

  async create(dto: NutritionFoodDto) {
    const key = dto.key ?? slug(dto.name);
    if (await this.repo().exist({ where: { key } }))
      throw new ConflictException({
        code: ErrorCode.CONFLICT,
        message: `A food with key "${key}" exists.`,
        details: { key },
      });
    this.checkMacros(dto);
    const f = await this.repo().save(
      this.repo().create({ key, source: 'staff', ...this.values(dto) }),
    );
    const created = foodView(await this.own(f.id));
    await this.audit.record({
      action: 'nutrition.food.create',
      targetType: 'nutrition_food',
      targetId: f.id,
      before: null,
      after: created,
    });
    return created;
  }

  async update(id: string, dto: UpdateNutritionFoodDto) {
    const f = await this.own(id);
    const next = { ...f, ...this.values(dto) };
    this.checkMacros(next);
    await this.repo().update({ id }, { ...this.values(dto), source: 'staff' });
    const after = foodView(await this.own(id));
    await this.audit.record({
      action: 'nutrition.food.update',
      targetType: 'nutrition_food',
      targetId: id,
      before: foodView(f),
      after,
    });
    return after;
  }

  async setActive(id: string, isActive: boolean) {
    const f = await this.own(id);
    await this.repo().update({ id }, { isActive });
    await this.audit.record({
      action: isActive
        ? 'nutrition.food.activate'
        : 'nutrition.food.deactivate',
      targetType: 'nutrition_food',
      targetId: id,
      before: { isActive: f.isActive },
      after: { isActive },
    });
    return { id, isActive };
  }

  /** `{ csv }` with FOODS_CSV_HEADER: insert or update by key; bad rows listed by line. */
  async import(csv: string) {
    const rows = parseCsv(csv);
    const head = (rows.shift() ?? []).map((h) => h.trim().toLowerCase());
    if (head.join(',') !== FOODS_CSV_HEADER.join(','))
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `The header must be: ${FOODS_CSV_HEADER.join(',')}`,
        details: { fields: { csv: ['Wrong header.'] } },
      });
    const errors: Array<{ line: number; error: string }> = [];
    let inserted = 0;
    let updated = 0;
    for (const [i, r] of rows.entries()) {
      const line = i + 2;
      if (!r.some((c) => c.trim())) continue;
      const [key, name, nameUr, group, ...nums] = r.map((c) => c.trim());
      const n = nums.map((x) => (x === '' ? null : Number(x)));
      const [kcal, protein, carbs, fat, fibre, sodium, piece] = n;
      const bad =
        !key || !/^[a-z0-9-]{2,64}$/.test(key)
          ? 'key: lower-case letters, digits and dashes'
          : !name
            ? 'name is required'
            : [kcal, protein, carbs, fat, fibre, sodium].some(
                  (x) => x === null || !Number.isFinite(x) || x! < 0,
                )
              ? 'kcal, protein_g, carbs_g, fat_g, fibre_g and sodium_mg must be numbers ≥ 0'
              : kcal! > 950
                ? 'kcal is per 100 g (at most 950)'
                : protein! + carbs! + fat! > 100.5
                  ? 'protein + carbs + fat is over 100 g'
                  : piece !== null && !(piece > 0)
                    ? 'piece_grams must be > 0'
                    : null;
      if (bad) {
        errors.push({ line, error: bad });
        continue;
      }
      const res = await this.dataSource.query(
        `INSERT INTO nutrition_foods (key, name, name_ur, food_group, source, kcal, protein_g, carbs_g, fat_g, fibre_g, sodium_mg, piece_grams)
         VALUES ($1, $2, $3, $4, 'staff', $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, name_ur = EXCLUDED.name_ur, food_group = EXCLUDED.food_group,
                source = 'staff', kcal = EXCLUDED.kcal, protein_g = EXCLUDED.protein_g, carbs_g = EXCLUDED.carbs_g,
                fat_g = EXCLUDED.fat_g, fibre_g = EXCLUDED.fibre_g, sodium_mg = EXCLUDED.sodium_mg,
                piece_grams = EXCLUDED.piece_grams, updated_at = now()
         RETURNING (xmax = 0) AS inserted`,
        [
          key,
          name.slice(0, 200),
          nameUr || null,
          (group || 'Staff').slice(0, 80),
          kcal,
          protein,
          carbs,
          fat,
          fibre,
          sodium,
          piece,
        ],
      );
      if (res[0]?.inserted) inserted++;
      else updated++;
    }
    await this.audit.record({
      action: 'nutrition.food.import',
      targetType: 'nutrition_food',
      targetId: null,
      details: { rejected: errors.length },
      // A bulk change: its size, not every row.
      before: null,
      after: { inserted, updated },
    });
    return { inserted, updated, rejected: errors.length, errors };
  }
}
