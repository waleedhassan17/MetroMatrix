import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { Specialty } from '../reference/entities/specialty.entity';
import { Condition } from '../reference/entities/condition.entity';
import { ConditionSpecialty } from '../reference/entities/condition-specialty.entity';
import {
  AdminConditionQueryDto,
  ConditionDto,
  ConditionSpecialtyDto,
  SpecialtyDto,
  UpdateConditionDto,
  UpdateSpecialtyDto,
} from './dto/admin-health.dto';
import { ErrorCode } from '../../../common/errors/codes';
import { likeEscape, paged } from '../../../common/pagination/pagination';
import { OperationalAuditService } from '../../../common/audit/operational-audit.service';

const notFound = (what: string) =>
  new NotFoundException({
    code: ErrorCode.NOT_FOUND,
    message: `${what} not found.`,
  });

const isUniqueViolation = (err: unknown) =>
  (err as { code?: string })?.code === '23505';

const words = (list: string[]) => [
  ...new Set(list.map((w) => w.trim().toLowerCase()).filter(Boolean)),
];

/**
 * Admin editing of the Healthcare reference data (specialties, conditions
 * and the condition → specialty ranking). Every write is audited and
 * refreshes the search vector of each doctor it affects, so discovery
 * matches the new words at once. Nothing is deleted — deactivate instead
 * (doctors and history keep pointing at the row).
 */
@Injectable()
export class AdminReferenceService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: OperationalAuditService,
  ) {}

  private async refreshDoctors(m: EntityManager, sql: string, id: string) {
    const rows: Array<{ id: string }> = await m.query(sql, [id]);
    for (const r of rows)
      await m.query(`SELECT doctor_search_refresh($1)`, [r.id]);
    return rows.length;
  }

  private bySpecialty(m: EntityManager, id: string) {
    return this.refreshDoctors(
      m,
      `SELECT id FROM doctors WHERE primary_specialty_id = $1
       UNION SELECT doctor_id FROM doctor_specialties WHERE specialty_id = $1`,
      id,
    );
  }

  private byCondition(m: EntityManager, id: string) {
    return this.refreshDoctors(
      m,
      `SELECT DISTINCT doctor_id AS id FROM doctor_conditions WHERE condition_id = $1`,
      id,
    );
  }

  private slugTaken(slug: string) {
    return new ConflictException({
      code: ErrorCode.CONFLICT,
      message: `The slug "${slug}" is already used.`,
      details: { fields: { slug: ['already used'] } },
    });
  }

  // ── Specialties ──────────────────────────────────────────────────────────

  async specialties() {
    const rows = await this.dataSource.query(
      `SELECT s.*, (SELECT count(*)::int FROM doctors d WHERE d.primary_specialty_id = s.id) AS doctors
         FROM specialties s ORDER BY s.is_active DESC, s.sort, s.name`,
    );
    return rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      nameUr: r.name_ur,
      slug: r.slug,
      icon: r.icon,
      description: r.description,
      keywords: r.keywords,
      sort: r.sort,
      isActive: r.is_active,
      doctors: r.doctors,
    }));
  }

  async createSpecialty(dto: SpecialtyDto) {
    try {
      const s = await this.dataSource.manager.save(
        this.dataSource.manager.create(Specialty, {
          name: dto.name,
          nameUr: dto.nameUr,
          slug: dto.slug,
          icon: dto.icon ?? null,
          description: dto.description ?? null,
          keywords: words(dto.keywords),
          sort: dto.sort ?? 0,
          isActive: true,
        }),
      );
      await this.audit.record({
        action: 'health.specialty.create',
        targetType: 'specialty',
        targetId: s.id,
        details: { slug: s.slug },
      });
      return s;
    } catch (err) {
      if (isUniqueViolation(err)) throw this.slugTaken(dto.slug);
      throw err;
    }
  }

  async updateSpecialty(id: string, dto: UpdateSpecialtyDto) {
    try {
      return await this.dataSource.transaction(async (m) => {
        const s = await m.findOne(Specialty, { where: { id } });
        if (!s) throw notFound('Specialty');
        Object.assign(s, {
          ...dto,
          keywords: dto.keywords ? words(dto.keywords) : s.keywords,
        });
        await m.save(s);
        const refreshed = await this.bySpecialty(m, id);
        await this.audit.record({
          action: 'health.specialty.update',
          targetType: 'specialty',
          targetId: id,
          details: { changed: Object.keys(dto), doctorsRefreshed: refreshed },
        });
        return s;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw this.slugTaken(dto.slug ?? '');
      throw err;
    }
  }

  // ── Conditions ───────────────────────────────────────────────────────────

  private async conditionViews(rows: Condition[]) {
    if (!rows.length) return [];
    const maps = await this.dataSource.query(
      `SELECT cs.condition_id, cs.rank, s.id, s.name, s.slug FROM condition_specialties cs
         JOIN specialties s ON s.id = cs.specialty_id
        WHERE cs.condition_id = ANY($1::uuid[]) ORDER BY cs.rank, s.name`,
      [rows.map((r) => r.id)],
    );
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      nameUr: c.nameUr,
      slug: c.slug,
      aliases: c.aliases,
      isCommon: c.isCommon,
      icon: c.icon,
      isActive: c.isActive,
      specialties: maps
        .filter((x: any) => x.condition_id === c.id)
        .map((x: any) => ({
          id: x.id,
          name: x.name,
          slug: x.slug,
          rank: x.rank,
        })),
    }));
  }

  async conditions(q: AdminConditionQueryDto) {
    const qb = this.dataSource.getRepository(Condition).createQueryBuilder('c');
    if (q.q)
      qb.where(
        "(c.name ILIKE :q OR c.slug ILIKE :q OR array_to_string(c.aliases, ' ') ILIKE :q)",
        {
          q: `%${likeEscape(q.q)}%`,
        },
      );
    const [rows, total] = await qb
      .orderBy('c.name', 'ASC')
      .skip((q.page - 1) * q.pageSize)
      .take(q.pageSize)
      .getManyAndCount();
    return paged(await this.conditionViews(rows), total, q);
  }

  async createCondition(dto: ConditionDto) {
    try {
      const c = await this.dataSource.manager.save(
        this.dataSource.manager.create(Condition, {
          name: dto.name,
          nameUr: dto.nameUr ?? null,
          slug: dto.slug,
          aliases: words(dto.aliases),
          isCommon: dto.isCommon ?? false,
          icon: dto.icon ?? null,
          isActive: true,
        }),
      );
      await this.audit.record({
        action: 'health.condition.create',
        targetType: 'condition',
        targetId: c.id,
        details: { slug: c.slug },
      });
      return (await this.conditionViews([c]))[0];
    } catch (err) {
      if (isUniqueViolation(err)) throw this.slugTaken(dto.slug);
      throw err;
    }
  }

  async updateCondition(id: string, dto: UpdateConditionDto) {
    try {
      const c = await this.dataSource.transaction(async (m) => {
        const c = await m.findOne(Condition, { where: { id } });
        if (!c) throw notFound('Condition');
        Object.assign(c, {
          ...dto,
          aliases: dto.aliases ? words(dto.aliases) : c.aliases,
        });
        await m.save(c);
        const refreshed = await this.byCondition(m, id);
        await this.audit.record({
          action: 'health.condition.update',
          targetType: 'condition',
          targetId: id,
          details: { changed: Object.keys(dto), doctorsRefreshed: refreshed },
        });
        return c;
      });
      return (await this.conditionViews([c]))[0];
    } catch (err) {
      if (isUniqueViolation(err)) throw this.slugTaken(dto.slug ?? '');
      throw err;
    }
  }

  /** Replace the ranked specialties for a condition ("pimples" → Acne → Dermatologist first). */
  async mapCondition(id: string, list: ConditionSpecialtyDto[]) {
    const c = await this.dataSource.transaction(async (m) => {
      const c = await m.findOne(Condition, { where: { id } });
      if (!c) throw notFound('Condition');
      const ids = [...new Set(list.map((x) => x.specialtyId))];
      const found = await m.count(Specialty, { where: { id: In(ids) } });
      if (found !== ids.length) throw notFound('Specialty');
      await m.delete(ConditionSpecialty, { conditionId: id });
      if (list.length) {
        await m.insert(
          ConditionSpecialty,
          ids.map((specialtyId) => ({
            conditionId: id,
            specialtyId,
            rank: list.find((x) => x.specialtyId === specialtyId)!.rank,
          })),
        );
      }
      await this.audit.record({
        action: 'health.condition.map',
        targetType: 'condition',
        targetId: id,
        details: { specialties: list },
      });
      return c;
    });
    return (await this.conditionViews([c]))[0];
  }
}
