import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource, In, IsNull } from 'typeorm';
import { DoctorReview } from './entities/doctor-review.entity';
import {
  AdminReviewQueryDto,
  CreateReviewDto,
  ReviewQueryDto,
} from './dto/review.dto';
import {
  DoctorAggregatesService,
  MIN_SAMPLES,
} from './doctor-aggregates.service';
import { AppointmentTransitionsService } from '../appointments/appointment-transitions.service';
import {
  AppointmentViewsService,
  REVIEW_WINDOW_MS,
} from '../appointments/appointment-views.service';
import {
  DiscoveryService,
  notListed,
  ReviewSummary,
  TITLE_PREFIX,
} from '../discovery/discovery.service';
import { DoctorInsightsService } from '../insights/doctor-insights.service';
import { DOCTOR_FROM_SQL, LISTED_DOCTOR_SQL } from '../discovery/listing-sql';
import { ErrorCode } from '../../../common/errors/codes';
import { paged } from '../../../common/pagination/pagination';
import { OperationalAuditService } from '../../../common/audit/operational-audit.service';
import { NotificationsService } from '../../notifications/notifications.service';

const notFound = () =>
  new NotFoundException({
    code: ErrorCode.NOT_FOUND,
    message: 'Review not found.',
  });

/** "Ayesha Khan" → "Ayesha K."; anonymous → initials only, "A. K." */
export function shortName(
  full: string | null | undefined,
  anonymous = false,
): string {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return anonymous ? 'P.' : 'Patient';
  const initial = (w: string) => `${w[0].toUpperCase()}.`;
  const last = parts.length > 1 ? parts[parts.length - 1] : null;
  if (anonymous)
    return last ? `${initial(parts[0])} ${initial(last)}` : initial(parts[0]);
  return last ? `${parts[0]} ${initial(last)}` : parts[0];
}

const isUniqueViolation = (err: unknown) =>
  (err as { code?: string })?.code === '23505';

/**
 * Verified-visit reviews. One per completed appointment, written by the
 * booking account within 30 days of completion. Public lists show visible
 * reviews only; the doctor sees hidden ones flagged and may reply; admins
 * hide and unhide (audited). Every change recomputes the doctor's rating.
 */
@Injectable()
export class ReviewsService implements OnModuleInit {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly transitions: AppointmentTransitionsService,
    private readonly views: AppointmentViewsService,
    private readonly discovery: DiscoveryService,
    private readonly insights: DoctorInsightsService,
    private readonly aggregates: DoctorAggregatesService,
    private readonly audit: OperationalAuditService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.discovery.reviewSummary = (doctorId) => this.summary(doctorId);
    this.views.reviewed = async (ids) => {
      if (!ids.length) return new Set();
      const rows = await this.dataSource.manager.find(DoctorReview, {
        select: { appointmentId: true },
        where: { appointmentId: In(ids) },
      });
      return new Set(rows.map((r) => r.appointmentId));
    };
    this.insights.ratingTrend = async (doctorId, from, to, tz) =>
      (
        await this.dataSource.query(
          `SELECT to_char((created_at AT TIME ZONE $4)::date, 'YYYY-MM-DD') AS date,
                  count(*)::int AS reviews, round(avg(overall)::numeric, 2)::float AS average
             FROM doctor_reviews
            WHERE doctor_id = $1 AND hidden_at IS NULL AND created_at >= $2 AND created_at < $3
            GROUP BY 1 ORDER BY 1`,
          [doctorId, from, to, tz],
        )
      ).map((r: { date: string; reviews: number; average: number }) => ({
        date: r.date,
        reviews: r.reviews,
        average: Number(r.average),
      }));
  }

  publicView(r: DoctorReview) {
    return {
      id: r.id,
      author: r.authorName,
      isAnonymous: r.isAnonymous,
      verifiedVisit: true,
      kind: r.kind,
      overall: r.overall,
      diagnosis: r.diagnosis,
      staff: r.staff,
      environment: r.environment,
      recommend: r.recommend,
      tags: r.tags,
      text: r.text,
      createdAt: r.createdAt,
      reply: r.doctorReply ? { text: r.doctorReply, at: r.repliedAt } : null,
    };
  }

  private doctorView(r: DoctorReview, appointmentCode?: string) {
    return {
      ...this.publicView(r),
      appointmentCode: appointmentCode ?? null,
      hidden: !!r.hiddenAt,
      hiddenReason: r.hiddenReason,
    };
  }

  // ── Patient ──────────────────────────────────────────────────────────────

  async create(
    userId: string,
    code: string,
    dto: CreateReviewDto,
    now = new Date(),
  ) {
    let review: DoctorReview;
    try {
      review = await this.dataSource.transaction(async (m) => {
        const a = await this.transitions.lock(m, {
          code,
          patientUserId: userId,
        });
        if (a.status !== 'completed' || !a.completedAt) {
          throw new ForbiddenException({
            code: ErrorCode.REVIEW_NOT_ALLOWED,
            message: 'You can review a visit once it is completed.',
            details: { reason: 'not_completed', status: a.status },
          });
        }
        if (now.getTime() - a.completedAt.getTime() > REVIEW_WINDOW_MS) {
          throw new ForbiddenException({
            code: ErrorCode.REVIEW_NOT_ALLOWED,
            message: 'Reviews can be written within 30 days of the visit.',
            details: { reason: 'window_closed' },
          });
        }
        if (await m.exists(DoctorReview, { where: { appointmentId: a.id } }))
          throw this.exists();
        const [u] = await m.query(
          `SELECT display_name FROM users WHERE id = $1`,
          [userId],
        );
        return m.save(
          m.create(DoctorReview, {
            appointmentId: a.id,
            doctorId: a.doctorId,
            patientUserId: userId,
            kind: a.kind,
            overall: dto.overall,
            diagnosis: dto.diagnosis,
            staff: dto.staff ?? null,
            // A video visit has no clinic to rate.
            environment: a.kind === 'clinic' ? (dto.environment ?? null) : null,
            recommend: dto.recommend,
            tags: [...new Set(dto.tags ?? [])],
            text: dto.text || null,
            isAnonymous: dto.isAnonymous === true,
            authorName: shortName(u?.display_name, dto.isAnonymous === true),
          }),
        );
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw this.exists();
      throw err;
    }
    await this.aggregates.refresh(null, [review.doctorId], now);
    await this.notifyDoctor(review);
    return this.publicView(review);
  }

  private exists() {
    return new ConflictException({
      code: ErrorCode.REVIEW_EXISTS,
      message: 'You have already reviewed this visit.',
    });
  }

  private async notifyDoctor(r: DoctorReview) {
    try {
      const [o] = await this.dataSource.query(
        `SELECT b.owner_user_id FROM doctors d JOIN businesses b ON b.id = d.business_id WHERE d.id = $1`,
        [r.doctorId],
      );
      await this.notifications.notify(o.owner_user_id, {
        type: 'health.review.new',
        title: `New ${r.overall}★ review`,
        body: r.text ? r.text.slice(0, 120) : 'A patient rated their visit.',
        data: { reviewId: r.id },
      });
    } catch (err) {
      this.logger.warn(`notification failed: ${(err as Error).message}`);
    }
  }

  // ── Public ───────────────────────────────────────────────────────────────

  private async assertListed(doctorId: string) {
    const [row] = await this.dataSource.query(
      `SELECT d.id ${DOCTOR_FROM_SQL} WHERE d.id = $1 AND ${LISTED_DOCTOR_SQL}`,
      [doctorId],
    );
    if (!row) throw notListed();
  }

  async publicList(doctorId: string, q: ReviewQueryDto) {
    await this.assertListed(doctorId);
    const qb = this.dataSource
      .getRepository(DoctorReview)
      .createQueryBuilder('r')
      .where('r.doctorId = :doctorId', { doctorId })
      .andWhere('r.hiddenAt IS NULL');
    if (q.kind) qb.andWhere('r.kind = :kind', { kind: q.kind });
    if (q.rating) qb.andWhere('r.overall = :rating', { rating: q.rating });
    const sort = q.sort ?? 'latest';
    if (sort === 'highest') qb.orderBy('r.overall', 'DESC');
    else if (sort === 'lowest') qb.orderBy('r.overall', 'ASC');
    qb.addOrderBy('r.createdAt', 'DESC').addOrderBy('r.id', 'ASC');
    const [rows, total] = await qb
      .skip((q.page - 1) * q.pageSize)
      .take(q.pageSize)
      .getManyAndCount();
    return paged(
      rows.map((r) => this.publicView(r)),
      total,
      q,
    );
  }

  async summary(doctorId: string): Promise<ReviewSummary> {
    const [[agg], stars, tags, latest] = await Promise.all([
      this.dataSource.query(
        `SELECT count(*)::int AS n,
                round(avg(overall)::numeric, 1)::float AS overall,
                round(avg(diagnosis)::numeric, 1)::float AS diagnosis,
                round(avg(staff)::numeric, 1)::float AS staff,
                round(avg(environment)::numeric, 1)::float AS environment,
                round(100.0 * avg(recommend::int))::int AS pct
           FROM doctor_reviews WHERE doctor_id = $1 AND hidden_at IS NULL`,
        [doctorId],
      ),
      this.dataSource.query(
        `SELECT overall, count(*)::int AS n FROM doctor_reviews
          WHERE doctor_id = $1 AND hidden_at IS NULL GROUP BY overall`,
        [doctorId],
      ),
      this.dataSource.query(
        `SELECT tag, count(*)::int AS count
           FROM doctor_reviews, unnest(tags) AS tag
          WHERE doctor_id = $1 AND hidden_at IS NULL
          GROUP BY tag ORDER BY count DESC, tag LIMIT 5`,
        [doctorId],
      ),
      this.dataSource.manager.find(DoctorReview, {
        where: { doctorId, hiddenAt: IsNull() },
        order: { createdAt: 'DESC', id: 'ASC' },
        take: 3,
      }),
    ]);
    const num = (v: unknown) =>
      v === null || v === undefined ? null : Number(v);
    return {
      count: agg.n,
      averages: {
        overall: num(agg.overall),
        diagnosis: num(agg.diagnosis),
        staff: num(agg.staff),
        environment: num(agg.environment),
      },
      satisfactionPct: agg.n >= MIN_SAMPLES ? agg.pct : null,
      distribution: [1, 2, 3, 4, 5].map(
        (star) =>
          stars.find((x: { overall: number }) => Number(x.overall) === star)
            ?.n ?? 0,
      ),
      topTags: tags,
      latest: latest.map((r) => this.publicView(r)),
    };
  }

  // ── Doctor ───────────────────────────────────────────────────────────────

  async doctorList(doctorId: string, q: ReviewQueryDto) {
    const qb = this.dataSource
      .getRepository(DoctorReview)
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.appointment', 'a')
      .where('r.doctorId = :doctorId', { doctorId });
    if (q.kind) qb.andWhere('r.kind = :kind', { kind: q.kind });
    if (q.rating) qb.andWhere('r.overall = :rating', { rating: q.rating });
    if (q.unreplied === 'true') qb.andWhere('r.doctorReply IS NULL');
    const sort = q.sort ?? 'latest';
    if (sort === 'highest') qb.orderBy('r.overall', 'DESC');
    else if (sort === 'lowest') qb.orderBy('r.overall', 'ASC');
    qb.addOrderBy('r.createdAt', 'DESC').addOrderBy('r.id', 'ASC');
    const [rows, total] = await qb
      .skip((q.page - 1) * q.pageSize)
      .take(q.pageSize)
      .getManyAndCount();
    return paged(
      rows.map((r) => this.doctorView(r, r.appointment?.code)),
      total,
      q,
    );
  }

  async reply(doctorId: string, id: string, text: string, now = new Date()) {
    const r = await this.dataSource.manager.findOne(DoctorReview, {
      where: { id, doctorId },
    });
    if (!r) throw notFound();
    r.doctorReply = text;
    r.repliedAt = now;
    await this.dataSource.manager.save(r);
    try {
      await this.notifications.notify(r.patientUserId, {
        type: 'health.review.reply',
        title: 'The doctor replied to your review',
        body: text.slice(0, 120),
        data: { reviewId: r.id },
      });
    } catch (err) {
      this.logger.warn(`notification failed: ${(err as Error).message}`);
    }
    return this.doctorView(r);
  }

  // ── Admin ────────────────────────────────────────────────────────────────

  async adminList(q: AdminReviewQueryDto) {
    const qb = this.dataSource
      .getRepository(DoctorReview)
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.appointment', 'a');
    if (q.doctorId) qb.andWhere('r.doctorId = :d', { d: q.doctorId });
    if (q.hidden === 'true') qb.andWhere('r.hiddenAt IS NOT NULL');
    if (q.hidden === 'false') qb.andWhere('r.hiddenAt IS NULL');
    const [rows, total] = await qb
      .orderBy('r.createdAt', 'DESC')
      .addOrderBy('r.id', 'ASC')
      .skip((q.page - 1) * q.pageSize)
      .take(q.pageSize)
      .getManyAndCount();
    const names = new Map<string, string>(
      rows.length
        ? (
            await this.dataSource.query(
              `SELECT id, title, full_name FROM doctors WHERE id = ANY($1::uuid[])`,
              [[...new Set(rows.map((r) => r.doctorId))]],
            )
          ).map((d: { id: string; title: string; full_name: string }) => [
            d.id,
            `${TITLE_PREFIX[d.title] ?? 'Dr.'} ${d.full_name}`,
          ])
        : [],
    );
    return paged(
      rows.map((r) => ({
        ...this.doctorView(r, r.appointment?.code),
        doctorId: r.doctorId,
        doctorName: names.get(r.doctorId) ?? null,
        patientUserId: r.patientUserId,
        authorName: r.authorName,
        hiddenAt: r.hiddenAt,
      })),
      total,
      q,
    );
  }

  async setHidden(
    adminUserId: string,
    id: string,
    hidden: boolean,
    reason: string | null,
    now = new Date(),
  ) {
    const r = await this.dataSource.manager.findOne(DoctorReview, {
      where: { id },
    });
    if (!r) throw notFound();
    Object.assign(r, {
      hiddenAt: hidden ? now : null,
      hiddenReason: hidden ? reason : null,
      hiddenByUserId: hidden ? adminUserId : null,
    });
    await this.dataSource.manager.save(r);
    await this.aggregates.refresh(null, [r.doctorId], now);
    await this.audit.record({
      actorUserId: adminUserId,
      action: hidden ? 'health.review.hide' : 'health.review.unhide',
      targetType: 'doctor_review',
      targetId: r.id,
      details: { doctorId: r.doctorId, reason },
    });
    return { ...this.doctorView(r), hiddenAt: r.hiddenAt };
  }
}
