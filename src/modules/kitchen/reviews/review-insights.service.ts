import { Injectable, Logger } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DataSource, EntityManager } from 'typeorm';
import { todayIn } from '../../../common/time/time.util';
import { returned } from '../../../common/db/parallel';
import type { VendorRef } from '../../food/vendor/food-vendor.service';
import { AiService } from '../../ai/ai.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { ReviewInsight } from '../entities/review-insight.entity';
import {
  anonymise,
  lexiconThemes,
  ReviewTheme,
  weeklyHeadline,
} from './review-lexicon';

/** A run needs this many new reviews. */
export const INSIGHT_MIN_REVIEWS = 5;
/** At most this many of the newest reviews are read. */
const INSIGHT_MAX_REVIEWS = 60;
/** The push goes out at most once a week. */
const PUSH_EVERY_DAYS = 7;

class ThemeAnswer {
  @IsString() @Length(2, 40) theme!: string;
  @IsIn(['positive', 'negative']) sentiment!: 'positive' | 'negative';
  @IsInt() @Min(1) @Max(1000) count!: number;
  @IsArray()
  @ArrayMaxSize(2)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  examples!: string[];
}
export class ThemesAnswer {
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => ThemeAnswer)
  themes!: ThemeAnswer[];
}
export const THEMES_SCHEMA = {
  type: 'object',
  properties: {
    themes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          theme: { type: 'string' },
          sentiment: { type: 'string', enum: ['positive', 'negative'] },
          count: { type: 'integer' },
          examples: { type: 'array', items: { type: 'string' } },
        },
        required: ['theme', 'sentiment', 'count', 'examples'],
      },
    },
  },
  required: ['themes'],
};
/** No theme can be mentioned by more reviews than were read. */
export const themesCheck = (reviews: number) => (a: ThemesAnswer) =>
  a.themes
    .filter((t) => t.count > reviews)
    .map((t) => `${t.theme}: count is more than the ${reviews} reviews`);

/**
 * Review insights (Chunk 5, P9): nightly, for each kitchen with at least 5
 * reviews since its last run, the themes customers keep mentioning —
 * review_themes@1 when AI is on, else the keyword lexicon — and once a week
 * a push: "This week: 6 reviews mention cold fries". Reviews are anonymised
 * before anything (model or lexicon) reads them; hidden ones are skipped.
 */
@Injectable()
export class ReviewInsightsService {
  private readonly logger = new Logger(ReviewInsightsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly ai: AiService,
    private readonly notifications: NotificationsService,
  ) {}

  /** One kitchen: a new insight when enough reviews came in, else null. */
  async compute(m: EntityManager, brandId: string, now = new Date()) {
    const [b] = await m.query(
      `SELECT fb.id, fb.business_id, b.owner_user_id, br.timezone,
              (SELECT max(covered_until) FROM review_insights ri WHERE ri.brand_id = fb.id) AS last
         FROM food_brands fb JOIN businesses b ON b.id = fb.business_id
         JOIN branches br ON br.brand_id = fb.id WHERE fb.id = $1`,
      [brandId],
    );
    if (!b) return null;
    const reviews: Array<{
      food_rating: number;
      text: string;
      created_at: Date;
    }> = await m.query(
      `SELECT food_rating, text, created_at FROM food_reviews
          WHERE brand_id = $1 AND NOT is_hidden AND text IS NOT NULL AND length(trim(text)) > 0
            AND date_trunc('milliseconds', created_at) > coalesce($2::timestamptz, '-infinity')
            AND date_trunc('milliseconds', created_at) <= $3
          ORDER BY created_at DESC LIMIT ${INSIGHT_MAX_REVIEWS}`,
      [brandId, b.last, now],
    );
    if (reviews.length < INSIGHT_MIN_REVIEWS) return null;
    const input = reviews.map((r) => ({
      rating: r.food_rating,
      text: anonymise(r.text),
    }));
    let themes: ReviewTheme[] = lexiconThemes(input);
    let method: 'ai' | 'lexicon' = 'lexicon';
    if (this.ai.usable('review_insights')) {
      const out = await this.ai.json({
        feature: 'review_insights',
        promptId: 'review_themes',
        input: { reviews: input },
        schema: THEMES_SCHEMA,
        dto: ThemesAnswer,
        check: themesCheck(input.length),
        actor: { businessId: b.business_id, userId: b.owner_user_id },
        temperature: 0.2,
      });
      if (out.ok) {
        themes = out.data.themes.map((t) => ({
          ...t,
          examples: t.examples.map(anonymise),
        }));
        method = 'ai';
      }
    }
    const day = (d: Date) => todayIn(b.timezone, d);
    const row = {
      brandId,
      periodStart: day(reviews[reviews.length - 1].created_at),
      periodEnd: day(now),
      reviewCount: reviews.length,
      themes,
      method,
      headline: weeklyHeadline(themes),
      coveredUntil: reviews[0].created_at,
    };
    const res = await m
      .createQueryBuilder()
      .insert()
      .into(ReviewInsight)
      .values(row)
      .orIgnore()
      .returning('id')
      .execute();
    if (!res.raw.length) return null;
    return {
      id: res.raw[0].id as string,
      owner: b.owner_user_id as string,
      ...row,
    };
  }

  /** The nightly step: every kitchen with new reviews; then the weekly push. Idempotent per day. */
  async runAll(now = new Date()) {
    const brands: Array<{ brand_id: string }> = await this.dataSource.query(
      `SELECT r.brand_id FROM food_reviews r
        WHERE NOT r.is_hidden AND r.text IS NOT NULL
          AND date_trunc('milliseconds', r.created_at) > coalesce((SELECT max(covered_until) FROM review_insights ri WHERE ri.brand_id = r.brand_id), '-infinity')
        GROUP BY r.brand_id HAVING count(*) >= ${INSIGHT_MIN_REVIEWS} ORDER BY r.brand_id`,
    );
    let insights = 0;
    let pushed = 0;
    for (const { brand_id } of brands) {
      const done = await this.dataSource.transaction(async (m) => {
        const [{ locked }] = await m.query(
          `SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked`,
          [`kitchen:review-insights:${brand_id}`],
        );
        return locked ? this.compute(m, brand_id, now) : null;
      });
      if (!done) continue;
      insights++;
      if (await this.push(done, now)) pushed++;
    }
    return { kitchens: brands.length, insights, pushed };
  }

  /** The weekly push, when the last one was a week ago or more. */
  private async push(
    i: { id: string; owner: string; brandId: string; headline: string | null },
    now: Date,
  ) {
    if (!i.headline) return false;
    const claimed = await this.dataSource.query(
      `UPDATE review_insights SET pushed_at = $2 WHERE id = $1 AND pushed_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM review_insights o WHERE o.brand_id = $3 AND o.pushed_at > $2::timestamptz - interval '${PUSH_EVERY_DAYS} days')
        RETURNING id`,
      [i.id, now, i.brandId],
    );
    if (!returned(claimed).length) return false;
    try {
      await this.notifications.notify(i.owner, {
        type: 'kitchen.review_insights',
        title: i.headline,
        body: 'See what your reviews are saying — themes and examples in Kitchen.',
        data: { screen: 'kitchen.review_insights', insightId: i.id },
      });
    } catch (err) {
      this.logger.warn(`push failed: ${(err as Error).message}`);
    }
    return true;
  }

  async view(v: VendorRef) {
    const rows = await this.dataSource.getRepository(ReviewInsight).find({
      where: { brandId: v.brandId },
      order: { periodEnd: 'DESC' },
      take: 8,
    });
    const [{ n }] = await this.dataSource.query(
      `SELECT count(*)::int AS n FROM food_reviews
        WHERE brand_id = $1 AND NOT is_hidden AND text IS NOT NULL
          AND date_trunc('milliseconds', created_at) > coalesce($2::timestamptz, '-infinity')`,
      [v.brandId, rows[0]?.coveredUntil ?? null],
    );
    const shape = (r: ReviewInsight) => ({
      id: r.id,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      reviewCount: r.reviewCount,
      method: r.method,
      headline: r.headline,
      themes: r.themes,
      computedAt: r.createdAt,
    });
    return {
      latest: rows[0] ? shape(rows[0]) : null,
      history: rows.slice(1).map(shape),
      newReviews: n,
      /** The next run happens once this many new reviews are in. */
      needed: INSIGHT_MIN_REVIEWS,
    };
  }
}
