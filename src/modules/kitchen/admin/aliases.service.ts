import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ErrorCode } from '../../../common/errors/codes';
import { OperationalAuditService } from '../../../common/audit/operational-audit.service';
import { paged } from '../../../common/pagination/pagination';
import { IngredientAlias } from '../entities/ingredient-alias.entity';
import { AliasDto, AliasesQueryDto } from '../dto/aliases.dto';

/**
 * Staff upkeep of ingredient_aliases — what people call an ingredient →
 * its canonical name. Voice, receipt scan, nutrition suggestions and the
 * pantry all read it. Every write is audited.
 */
@Injectable()
export class AliasesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: OperationalAuditService,
  ) {}

  async list(q: AliasesQueryDto) {
    const qb = this.dataSource
      .getRepository(IngredientAlias)
      .createQueryBuilder('a');
    if (q.q)
      qb.where('(a.alias ILIKE :like OR a.canonical ILIKE :like)', {
        like: `%${q.q.replace(/[%_\\]/g, '\\$&')}%`,
      });
    if (q.canonical)
      qb.andWhere('a.canonical = :c', { c: q.canonical.toLowerCase() });
    if (q.lang) qb.andWhere('a.lang = :l', { l: q.lang });
    const [rows, total] = await qb
      .orderBy('a.canonical', 'ASC')
      .addOrderBy('a.alias', 'ASC')
      .skip((q.page - 1) * q.pageSize)
      .take(q.pageSize)
      .getManyAndCount();
    const canonicals = await this.dataSource.query(
      `SELECT count(DISTINCT canonical)::int AS n FROM ingredient_aliases`,
    );
    return {
      ...paged(
        rows.map((a) => ({
          id: a.id,
          alias: a.alias,
          canonical: a.canonical,
          lang: a.lang,
        })),
        total,
        q,
      ),
      canonicals: canonicals[0].n,
    };
  }

  async create(dto: AliasDto) {
    const repo = this.dataSource.getRepository(IngredientAlias);
    const alias = dto.alias.trim();
    const taken = await repo.findOne({ where: { alias } });
    if (taken)
      throw new ConflictException({
        code: ErrorCode.CONFLICT,
        message: `“${alias}” already means ${taken.canonical}.`,
        details: { alias, canonical: taken.canonical },
      });
    const a = await repo.save(
      repo.create({
        alias,
        canonical: dto.canonical.trim().toLowerCase(),
        lang: dto.lang,
      }),
    );
    await this.audit.record({
      action: 'kitchen.alias.create',
      targetType: 'ingredient_alias',
      targetId: a.id,
      before: null,
      after: { alias, canonical: a.canonical, lang: a.lang },
    });
    return { id: a.id, alias: a.alias, canonical: a.canonical, lang: a.lang };
  }

  async remove(id: string) {
    const repo = this.dataSource.getRepository(IngredientAlias);
    const a = await repo.findOne({ where: { id } });
    if (!a)
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Alias not found.',
      });
    await repo.delete({ id });
    await this.audit.record({
      action: 'kitchen.alias.delete',
      targetType: 'ingredient_alias',
      targetId: id,
      before: { alias: a.alias, canonical: a.canonical, lang: a.lang },
      after: null,
    });
    return { removed: true };
  }
}
