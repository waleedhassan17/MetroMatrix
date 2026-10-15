import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { likeEscape } from '../../../common/pagination/pagination';
import { ConditionQueryDto } from './dto/reference.dto';

/** Below this, a near-miss is not treated as a match (as in Shopping). */
export const TRIGRAM_MIN = 0.55;

export const specialtyView = (r: any) => ({
  id: r.id,
  name: r.name,
  nameUr: r.name_ur,
  slug: r.slug,
  icon: r.icon,
  description: r.description,
});

export const conditionView = (r: any) => ({
  id: r.id,
  name: r.name,
  nameUr: r.name_ur,
  slug: r.slug,
  isCommon: r.is_common,
  specialties: (r.specialties ?? []) as Array<{
    id: string;
    name: string;
    nameUr: string;
    slug: string;
  }>,
});

/**
 * Conditions matching what someone typed: their name, Urdu name or any alias
 * ("pimples" → Acne), allowing typos. Alias "a". $1 = raw text, $2 = %like%.
 */
const CONDITION_MATCH = `(
  c.name ILIKE $2 OR c.name_ur LIKE $2
  OR word_similarity($1, c.name) >= ${TRIGRAM_MIN}
  OR EXISTS (SELECT 1 FROM unnest(c.aliases) a WHERE a ILIKE $2 OR word_similarity($1, a) >= ${TRIGRAM_MIN})
)`;

/** Specialties by name, Urdu name or lay keyword ("skin", "jild"). Alias s. */
const SPECIALTY_MATCH = `(
  s.name ILIKE $2 OR s.name_ur LIKE $2
  OR word_similarity($1, s.name) >= ${TRIGRAM_MIN}
  OR EXISTS (SELECT 1 FROM unnest(s.keywords) k WHERE k ILIKE $2 OR word_similarity($1, k) >= ${TRIGRAM_MIN})
)`;

/**
 * Specialties and conditions: the reference data discovery is built on.
 * Shared by the public routes and search-as-you-type.
 */
@Injectable()
export class ReferenceService {
  constructor(private readonly dataSource: DataSource) {}

  async specialties() {
    const rows = await this.dataSource.query(
      `SELECT id, name, name_ur, slug, icon, description FROM specialties WHERE is_active ORDER BY sort, name`,
    );
    return rows.map(specialtyView);
  }

  async conditions(q: ConditionQueryDto) {
    // $1/$2 only exist when searching: Postgres rejects untyped, unused parameters.
    const params: unknown[] = q.q ? [q.q, `%${likeEscape(q.q)}%`] : [];
    const where = ['c.is_active'];
    if (q.q) where.push(CONDITION_MATCH);
    if (q.common === 'true') where.push('c.is_common');
    const rows = await this.dataSource.query(
      `SELECT c.id, c.name, c.name_ur, c.slug, c.is_common,
              coalesce((SELECT json_agg(json_build_object('id', s.id, 'name', s.name, 'nameUr', s.name_ur, 'slug', s.slug) ORDER BY cs.rank)
                          FROM condition_specialties cs JOIN specialties s ON s.id = cs.specialty_id
                         WHERE cs.condition_id = c.id AND s.is_active), '[]') AS specialties
         FROM conditions c
        WHERE ${where.join(' AND ')}
        ORDER BY ${q.q ? `(c.name ILIKE $2) DESC, word_similarity($1, c.name) DESC,` : ''} c.is_common DESC, c.name
        LIMIT 100`,
      params,
    );
    return rows.map(conditionView);
  }

  /**
   * Specialties for a search: direct matches first, then the first-choice
   * specialty of every matching condition ("pimples" → Acne → Dermatologist).
   */
  async matchSpecialties(text: string, limit: number) {
    const rows = await this.dataSource.query(
      `WITH direct AS (
         SELECT s.id, 0 AS via, (s.name ILIKE $2 OR s.name_ur LIKE $2) AS exact, word_similarity($1, s.name) AS sim
           FROM specialties s WHERE s.is_active AND ${SPECIALTY_MATCH}
       ), via_condition AS (
         SELECT cs.specialty_id AS id, 1 AS via, false AS exact, 0::real AS sim
           FROM conditions c JOIN condition_specialties cs ON cs.condition_id = c.id AND cs.rank = 1
          WHERE c.is_active AND ${CONDITION_MATCH}
       ), ranked AS (
         SELECT id, min(via) AS via, bool_or(exact) AS exact, max(sim) AS sim FROM (
           SELECT * FROM direct UNION ALL SELECT * FROM via_condition
         ) x GROUP BY id
       )
       SELECT s.id, s.name, s.name_ur, s.slug, s.icon, s.description
         FROM ranked r JOIN specialties s ON s.id = r.id AND s.is_active
        ORDER BY r.via, r.exact DESC, r.sim DESC, s.sort, s.name
        LIMIT $3`,
      [text, `%${likeEscape(text)}%`, limit],
    );
    return rows.map(specialtyView);
  }

  async matchConditions(text: string, limit: number) {
    return (await this.conditions({ q: text })).slice(0, limit);
  }
}
