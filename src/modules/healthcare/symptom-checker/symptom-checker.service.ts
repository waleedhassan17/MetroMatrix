import {
  HttpException,
  HttpStatus,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { SymptomCheck, SymptomSource } from './entities/symptom-check.entity';
import { SymptomCheckDto } from './dto/symptom-check.dto';
import { EMERGENCY_CONTACTS, redFlags } from './red-flags';
import { KeywordData, keywordUrgency, matchKeywords } from './keyword-matcher';
import { SymptomModel, Urgency } from './symptom-model';
import { specialtyView } from '../reference/reference.service';
import { FamilyService, ageFrom } from '../family/family.service';
import { HealthJobsService } from '../jobs/health-jobs.service';
import { AccountService } from '../../auth/account.service';
import { ErrorCode } from '../../../common/errors/codes';

export const SYMPTOM_LIMIT_PER_HOUR = 10;
export const SYMPTOM_TEXT_RETENTION_DAYS = 30;
export const DEFAULT_SPECIALTY = 'general-physician';
const KEYWORD_CACHE_MS = 5 * 60_000;

export const DISCLAIMER =
  'This is not a diagnosis or medical advice. It only suggests which kind of doctor to see. ' +
  'If you feel very unwell or your symptoms get worse, call 1122 or 115, or go to the nearest emergency department.';

const ADVICE: Record<Urgency, string> = {
  routine:
    'Book a visit in the coming days. If it gets worse, see a doctor sooner.',
  soon: 'See a doctor within 24 hours — sooner if it gets worse.',
  urgent: 'Seek care today.',
};

/**
 * "Which doctor should I see?" — in this order:
 * 1. red-flag rules (English + Roman Urdu): an emergency answer, no model call;
 * 2. the model (Gemini, when GEMINI_API_KEY is set), validated against the live specialties;
 * 3. the keyword matcher over the reference tables; General Physician by default.
 * Always with a disclaimer. 10 checks per user per hour (counted in the
 * database, so restarts don't reset it); free text purged after 30 days.
 */
@Injectable()
export class SymptomCheckerService implements OnModuleInit {
  private cache: { at: number; data: KeywordData } | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly model: SymptomModel,
    private readonly family: FamilyService,
    private readonly jobs: HealthJobsService,
    private readonly account: AccountService,
  ) {}

  onModuleInit(): void {
    this.jobs.nightly.push(async (m, now) => ({
      symptomTextPurged: await this.purge(m, now),
    }));
    this.account.onAccountDeleted(async (m, user) => {
      await m.delete(SymptomCheck, { userId: user.id });
    });
  }

  async purge(m: EntityManager, now = new Date()): Promise<number> {
    const [, n] = await m.query(
      `UPDATE symptom_checks SET text = NULL, updated_at = now()
        WHERE text IS NOT NULL AND created_at < $1::timestamptz - make_interval(days => $2)`,
      [now, SYMPTOM_TEXT_RETENTION_DAYS],
    );
    return n ?? 0;
  }

  private async keywordData(): Promise<KeywordData> {
    if (this.cache && Date.now() - this.cache.at < KEYWORD_CACHE_MS)
      return this.cache.data;
    const [specialties, conditions] = await Promise.all([
      this.dataSource.query(
        `SELECT id, slug, name, keywords FROM specialties WHERE is_active ORDER BY sort, name`,
      ),
      this.dataSource.query(
        `SELECT c.id, c.name, c.aliases, s.slug AS specialty_slug
           FROM conditions c
           JOIN condition_specialties cs ON cs.condition_id = c.id AND cs.rank = 1
           JOIN specialties s ON s.id = cs.specialty_id AND s.is_active
          WHERE c.is_active ORDER BY c.is_common DESC, c.name`,
      ),
    ]);
    const data: KeywordData = {
      specialties: specialties.map((s: any) => ({
        id: s.id,
        slug: s.slug,
        name: s.name,
        keywords: s.keywords ?? [],
      })),
      conditions: conditions.map((c: any) => ({
        id: c.id,
        name: c.name,
        aliases: c.aliases ?? [],
        specialtySlug: c.specialty_slug,
      })),
    };
    this.cache = { at: Date.now(), data };
    return data;
  }

  /** Reserve one of the hour's checks atomically (the row is the counter). */
  private async reserve(userId: string, text: string, now: Date) {
    return this.dataSource.transaction(async (m) => {
      await m.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `symptom-check:${userId}`,
      ]);
      const [{ n, oldest }] = await m.query(
        `SELECT count(*)::int AS n, min(created_at) AS oldest FROM symptom_checks
          WHERE user_id = $1 AND created_at > $2::timestamptz - interval '1 hour'`,
        [userId, now],
      );
      if (n >= SYMPTOM_LIMIT_PER_HOUR) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil(
            (new Date(oldest).getTime() + 3600_000 - now.getTime()) / 1000,
          ),
        );
        throw new HttpException(
          {
            code: ErrorCode.SYMPTOM_CHECK_LIMIT,
            message: `You can run ${SYMPTOM_LIMIT_PER_HOUR} symptom checks an hour. Try again later.`,
            details: { limit: SYMPTOM_LIMIT_PER_HOUR, retryAfterSeconds },
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      const row = await m.save(
        m.create(SymptomCheck, {
          userId,
          text,
          source: 'fallback',
          emergency: false,
          result: {},
        }),
      );
      return row.id;
    });
  }

  async check(userId: string, dto: SymptomCheckDto, now = new Date()) {
    let age = dto.age ?? null;
    let gender: string | null = dto.gender ?? null;
    if (dto.familyMemberId) {
      const f = await this.family.owned(userId, dto.familyMemberId);
      age = ageFrom(f.dateOfBirth, now) ?? age;
      gender = f.gender ?? gender;
    }
    const checkId = await this.reserve(userId, dto.text, now);
    const { source, result } = await this.answer(dto.text, age, gender);
    await this.dataSource.query(
      `UPDATE symptom_checks SET source = $2, emergency = $3, result = $4::jsonb, updated_at = now() WHERE id = $1`,
      [checkId, source, result.emergency === true, JSON.stringify(result)],
    );
    return { checkId, ...result, disclaimer: DISCLAIMER };
  }

  private async answer(
    text: string,
    age: number | null,
    gender: string | null,
  ): Promise<{ source: SymptomSource; result: Record<string, unknown> }> {
    const flags = redFlags(text);
    if (flags.length) {
      const selfHarm = flags.some((f) => f.id === 'self_harm');
      return {
        source: 'red_flag',
        result: {
          emergency: true,
          source: 'red_flag',
          flags,
          message: selfHarm
            ? 'You deserve support right now. If you might act on these thoughts, call 1122 or go to the nearest emergency department, and tell someone you trust.'
            : 'This could be an emergency. Call 1122 or 115 now, or go to the nearest emergency department. Do not wait for an appointment.',
          contacts: EMERGENCY_CONTACTS,
        },
      };
    }

    const data = await this.keywordData();
    const bySlug = new Map(data.specialties.map((s) => [s.slug, s]));
    const view = async (slugs: string[]) => {
      if (!slugs.length) return [];
      const rows = await this.dataSource.query(
        `SELECT id, name, name_ur, slug, icon, description FROM specialties WHERE slug = ANY($1::text[])`,
        [slugs],
      );
      const bySlugRow = new Map(
        rows.map((r: any) => [r.slug, specialtyView(r)]),
      );
      return slugs.map((s) => bySlugRow.get(s)).filter(Boolean);
    };

    const suggestion = this.model.enabled
      ? await this.model.suggest(
          { text, age, gender },
          data.specialties.map((s) => ({ slug: s.slug, name: s.name })),
        )
      : null;
    if (suggestion && bySlug.has(suggestion.specialtySlug)) {
      const [specialty, ...alternatives] = await view([
        suggestion.specialtySlug,
        ...suggestion.alternativeSlugs,
      ]);
      return {
        source: 'model',
        result: {
          emergency: false,
          source: 'model',
          urgency: suggestion.urgency,
          advice: suggestion.advice,
          specialty,
          alternatives,
          possibleConditions: [],
        },
      };
    }

    const match = matchKeywords(text, data);
    const slugs = match.ranked.length
      ? match.ranked.slice(0, 3)
      : [DEFAULT_SPECIALTY];
    const [specialty, ...alternatives] = await view(slugs);
    const urgency = keywordUrgency(text);
    return {
      source: 'fallback',
      result: {
        emergency: false,
        source: 'fallback',
        urgency,
        advice: ADVICE[urgency],
        specialty,
        alternatives,
        possibleConditions: match.conditions,
      },
    };
  }
}
