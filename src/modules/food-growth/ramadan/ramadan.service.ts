import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ErrorCode } from '../../../common/errors/codes';
import { OperationalAuditService } from '../../../common/audit/operational-audit.service';
import { paged } from '../../../common/pagination/pagination';
import {
  addDays,
  localDate,
  parseTime,
  todayIn,
  wallTimeToInstant,
} from '../../../common/time/time.util';
import type { VendorRef } from '../../food/vendor/food-vendor.service';
import { BranchStateService } from '../../food/availability/branch-state.service';
import type { DateHours, Interval } from '../../food/availability/open-state';
import { FoodDiscoveryService } from '../../food/discovery/discovery.service';
import { CalendarEvent } from '../../food/reference/entities/calendar-event.entity';
import { RamadanSettings } from './entities/ramadan-settings.entity';
import {
  CalendarEventDto,
  CalendarEventsQueryDto,
  RamadanSettingsDto,
  UpdateCalendarEventDto,
} from './dto/ramadan.dto';

const invalid = (field: string, message: string) =>
  new BadRequestException({
    code: ErrorCode.VALIDATION_FAILED,
    message,
    details: { fields: { [field]: [message] } },
  });

/** Calendar events may be at most this long (Ramadan is 29–30 days). */
const MAX_EVENT_DAYS = 45;

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);

interface WindowRow {
  branch_id: string;
  timezone: string;
  sehri_from: string | null;
  sehri_to: string | null;
  iftar_from: string | null;
  iftar_to: string | null;
  iftar_preorder_only: boolean;
  starts_on: string;
  ends_on: string;
  name: string;
}

/**
 * Ramadan mode. A kitchen sets its sehri and iftar windows once; they replace
 * its weekly hours only on dates inside a `ramadan` calendar event for its
 * city (or everywhere), through BranchStateService.dateOverrides — so the
 * open state, discovery, cart, checkout and scheduled orders all follow it.
 * Outside the event nothing changes. Staff manage the calendar.
 */
@Injectable()
export class RamadanService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly state: BranchStateService,
    private readonly discovery: FoodDiscoveryService,
    private readonly audit: OperationalAuditService,
  ) {}

  onModuleInit(): void {
    this.state.dateOverrides = (m, ids, now) => this.overrides(m, ids, now);
    this.discovery.railSources.push((ctx) => this.iftarRail(ctx));
    this.discovery.vendorExtras.push(async (v, now) => ({
      ramadan: await this.vendorBlock(v.branchId, now),
    }));
  }

  /** Enabled kitchens' windows on Ramadan dates near `now` (a day either side of a week). */
  private async windows(
    m: EntityManager,
    branchIds: string[],
    now: Date,
  ): Promise<WindowRow[]> {
    if (!branchIds.length) return [];
    const today = localDate(now, 'UTC');
    return m.query(
      `SELECT rs.branch_id, br.timezone, rs.sehri_from::text, rs.sehri_to::text,
              rs.iftar_from::text, rs.iftar_to::text, rs.iftar_preorder_only, ce.name,
              to_char(ce.starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ce.ends_on, 'YYYY-MM-DD') AS ends_on
         FROM ramadan_settings rs JOIN branches br ON br.id = rs.branch_id
         JOIN calendar_events ce ON ce.kind = 'ramadan'
              AND (ce.city IS NULL OR lower(ce.city) = lower(br.city))
              AND ce.ends_on >= $2::date - 2 AND ce.starts_on <= $2::date + 10
        WHERE rs.branch_id = ANY($1::uuid[]) AND rs.enabled
          AND (rs.sehri_from IS NOT NULL OR rs.iftar_from IS NOT NULL)`,
      [branchIds, today],
    );
  }

  /** BranchStateService.dateOverrides: event dates → the windows; iftar pre-order stretches. */
  async overrides(m: EntityManager, branchIds: string[], now: Date) {
    const out = new Map<
      string,
      { byDate: DateHours; preorderWindows: Interval[] }
    >();
    const today = localDate(now, 'UTC');
    for (const w of await this.windows(m, branchIds, now)) {
      const o = out.get(w.branch_id) ?? {
        byDate: new Map() as DateHours,
        preorderWindows: [] as Interval[],
      };
      out.set(w.branch_id, o);
      const first =
        w.starts_on > addDays(today, -2) ? w.starts_on : addDays(today, -2);
      const last =
        w.ends_on < addDays(today, 10) ? w.ends_on : addDays(today, 10);
      for (let d = first; d <= last; d = addDays(d, 1)) {
        const ranges: Array<{ opens: number; closes: number }> = [];
        if (w.sehri_from && w.sehri_to)
          ranges.push({
            opens: parseTime(hhmm(w.sehri_from)!),
            closes: parseTime(hhmm(w.sehri_to)!),
          });
        if (w.iftar_from && w.iftar_to) {
          const opens = parseTime(hhmm(w.iftar_from)!);
          const closes = parseTime(hhmm(w.iftar_to)!);
          ranges.push({ opens, closes });
          if (w.iftar_preorder_only) {
            const start = wallTimeToInstant(d, opens, w.timezone);
            const end = wallTimeToInstant(
              d,
              closes > opens ? closes : closes + 1440,
              w.timezone,
            );
            if (start && end) o.preorderWindows.push({ start, end });
          }
        }
        o.byDate.set(d, ranges);
      }
    }
    return out;
  }

  /** Today's Ramadan for a kitchen: the event and its windows, or null. */
  async vendorBlock(branchId: string, now = new Date()) {
    const [w] = (
      await this.windows(this.dataSource.manager, [branchId], now)
    ).filter((x) => {
      const today = todayIn(x.timezone, now);
      return x.starts_on <= today && x.ends_on >= today;
    });
    if (!w) return null;
    return {
      event: { name: w.name, startsOn: w.starts_on, endsOn: w.ends_on },
      sehri: w.sehri_from
        ? { from: hhmm(w.sehri_from), to: hhmm(w.sehri_to) }
        : null,
      iftar: w.iftar_from
        ? { from: hhmm(w.iftar_from), to: hhmm(w.iftar_to) }
        : null,
      iftarPreorderOnly: w.iftar_preorder_only && !!w.iftar_from,
    };
  }

  /** Home rail: kitchens near you with an iftar window today, best rated first. */
  private async iftarRail(ctx: {
    brandIds: string[];
    now: Date;
  }): Promise<Record<string, string[]>> {
    if (!ctx.brandIds.length) return {};
    const rows: Array<{ brand_id: string; timezone: string } & WindowRow> =
      await this.dataSource.query(
        `SELECT fb.id AS brand_id, br.id AS branch_id, br.timezone,
                to_char(ce.starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ce.ends_on, 'YYYY-MM-DD') AS ends_on
           FROM food_brands fb JOIN branches br ON br.brand_id = fb.id
           JOIN ramadan_settings rs ON rs.branch_id = br.id AND rs.enabled AND rs.iftar_from IS NOT NULL
           JOIN calendar_events ce ON ce.kind = 'ramadan'
                AND (ce.city IS NULL OR lower(ce.city) = lower(br.city))
                AND ce.ends_on >= $2::date - 1 AND ce.starts_on <= $2::date + 1
          WHERE fb.id = ANY($1::uuid[])
          ORDER BY fb.rating_avg DESC, fb.rating_count DESC, fb.id`,
        [ctx.brandIds, localDate(ctx.now, 'UTC')],
      );
    const ids = rows
      .filter((r) => {
        const today = todayIn(r.timezone, ctx.now);
        return r.starts_on <= today && r.ends_on >= today;
      })
      .map((r) => r.brand_id);
    return ids.length ? { iftarNearYou: [...new Set(ids)] } : {};
  }

  // ── Vendor: GET/PUT /food/vendor/ramadan ─────────────────────────────

  async get(v: VendorRef, now = new Date()) {
    const s = await this.dataSource
      .getRepository(RamadanSettings)
      .findOne({ where: { branchId: v.branchId } });
    const [b] = await this.dataSource.query(
      `SELECT city, timezone FROM branches WHERE id = $1`,
      [v.branchId],
    );
    const today = todayIn(b.timezone, now);
    const events = await this.dataSource.query(
      `SELECT id, name, to_char(starts_on, 'YYYY-MM-DD') AS "startsOn", to_char(ends_on, 'YYYY-MM-DD') AS "endsOn", city
         FROM calendar_events
        WHERE kind = 'ramadan' AND (city IS NULL OR lower(city) = lower($1)) AND ends_on >= $2::date
        ORDER BY starts_on LIMIT 5`,
      [b.city, today],
    );
    const active = await this.vendorBlock(v.branchId, now);
    return {
      settings: {
        enabled: s?.enabled ?? false,
        sehriFrom: hhmm(s?.sehriFrom ?? null),
        sehriTo: hhmm(s?.sehriTo ?? null),
        iftarFrom: hhmm(s?.iftarFrom ?? null),
        iftarTo: hhmm(s?.iftarTo ?? null),
        iftarPreorderOnly: s?.iftarPreorderOnly ?? false,
        notes: s?.notes ?? null,
      },
      /** Ramadan on the calendar for this city, now or ahead. */
      events,
      /** Today inside an event with the windows on: the hours customers see today. */
      activeToday: !!active,
      today: active,
    };
  }

  async put(v: VendorRef, dto: RamadanSettingsDto, now = new Date()) {
    const pair = (
      from: string | null | undefined,
      to: string | null | undefined,
      name: string,
    ) => {
      if (!!from !== !!to)
        throw invalid(
          from ? `${name}To` : `${name}From`,
          `Give both ends of the ${name} window, or neither.`,
        );
      if (from && from === to)
        throw invalid(
          `${name}To`,
          `The ${name} window can’t start and end at the same time.`,
        );
    };
    pair(dto.sehriFrom, dto.sehriTo, 'sehri');
    pair(dto.iftarFrom, dto.iftarTo, 'iftar');
    if (dto.enabled && !dto.sehriFrom && !dto.iftarFrom)
      throw invalid(
        'enabled',
        'Set a sehri or an iftar window before turning Ramadan hours on.',
      );
    if (dto.iftarPreorderOnly && !dto.iftarFrom)
      throw invalid('iftarPreorderOnly', 'Set the iftar window first.');
    await this.dataSource.query(
      `INSERT INTO ramadan_settings (branch_id, enabled, sehri_from, sehri_to, iftar_from, iftar_to, iftar_preorder_only, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (branch_id) DO UPDATE SET enabled = EXCLUDED.enabled, sehri_from = EXCLUDED.sehri_from,
         sehri_to = EXCLUDED.sehri_to, iftar_from = EXCLUDED.iftar_from, iftar_to = EXCLUDED.iftar_to,
         iftar_preorder_only = EXCLUDED.iftar_preorder_only, notes = EXCLUDED.notes, updated_at = now()`,
      [
        v.branchId,
        dto.enabled,
        dto.sehriFrom ?? null,
        dto.sehriTo ?? null,
        dto.iftarFrom ?? null,
        dto.iftarTo ?? null,
        dto.iftarPreorderOnly ?? false,
        dto.notes ?? null,
      ],
    );
    return this.get(v, now);
  }

  // ── Staff: /admin/food/calendar-events ───────────────────────────────

  private eventView(e: CalendarEvent) {
    return {
      id: e.id,
      kind: e.kind,
      name: e.name,
      startsOn: e.startsOn,
      endsOn: e.endsOn,
      city: e.city,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    };
  }

  private checkDates(startsOn: string, endsOn: string) {
    if (endsOn < startsOn)
      throw invalid('endsOn', 'The event can’t end before it starts.');
    if (addDays(startsOn, MAX_EVENT_DAYS - 1) < endsOn)
      throw invalid('endsOn', `An event is at most ${MAX_EVENT_DAYS} days.`);
  }

  async listEvents(q: CalendarEventsQueryDto) {
    const qb = this.dataSource
      .getRepository(CalendarEvent)
      .createQueryBuilder('e');
    if (q.kind) qb.andWhere('e.kind = :kind', { kind: q.kind });
    if (q.from) qb.andWhere('e.ends_on >= :from', { from: q.from });
    if (q.city)
      qb.andWhere('(e.city IS NULL OR lower(e.city) = lower(:city))', {
        city: q.city,
      });
    const [rows, total] = await qb
      .orderBy('e.startsOn', 'DESC')
      .addOrderBy('e.id', 'ASC')
      .skip((q.page - 1) * q.pageSize)
      .take(q.pageSize)
      .getManyAndCount();
    return paged(
      rows.map((e) => this.eventView(e)),
      total,
      q,
    );
  }

  private async event(id: string) {
    const e = await this.dataSource
      .getRepository(CalendarEvent)
      .findOne({ where: { id } });
    if (!e)
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Calendar event not found.',
      });
    return e;
  }

  async createEvent(dto: CalendarEventDto) {
    this.checkDates(dto.startsOn, dto.endsOn);
    const repo = this.dataSource.getRepository(CalendarEvent);
    const e = await repo.save(
      repo.create({
        kind: dto.kind,
        name: dto.name,
        startsOn: dto.startsOn,
        endsOn: dto.endsOn,
        city: dto.city ?? null,
      }),
    );
    await this.audit.record({
      action: 'calendar_event.create',
      targetType: 'calendar_event',
      targetId: e.id,
      details: {
        kind: e.kind,
        startsOn: e.startsOn,
        endsOn: e.endsOn,
        city: e.city,
      },
    });
    return this.eventView(await this.event(e.id));
  }

  async updateEvent(id: string, dto: UpdateCalendarEventDto) {
    const e = await this.event(id);
    const next = {
      kind: dto.kind ?? e.kind,
      name: dto.name ?? e.name,
      startsOn: dto.startsOn ?? e.startsOn,
      endsOn: dto.endsOn ?? e.endsOn,
      city: dto.city !== undefined ? dto.city : e.city,
    };
    this.checkDates(next.startsOn, next.endsOn);
    await this.dataSource.getRepository(CalendarEvent).update({ id }, next);
    await this.audit.record({
      action: 'calendar_event.update',
      targetType: 'calendar_event',
      targetId: id,
      details: { changed: Object.keys(dto) },
    });
    return this.eventView(await this.event(id));
  }

  async removeEvent(id: string) {
    const e = await this.event(id);
    await this.dataSource.getRepository(CalendarEvent).delete({ id });
    await this.audit.record({
      action: 'calendar_event.delete',
      targetType: 'calendar_event',
      targetId: id,
      details: { kind: e.kind, name: e.name },
    });
    return { removed: true };
  }
}
