import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { Doctor } from './entities/doctor.entity';
import {
  DoctorCondition,
  DoctorExperience,
  DoctorQualification,
  DoctorServiceItem,
  DoctorSpecialty,
} from './entities/doctor-children.entity';
import { DoctorPaymentAccount } from './entities/doctor-payment-account.entity';
import {
  DoctorPaymentAccountDto,
  UpdateDoctorPaymentAccountDto,
  UpdateDoctorProfileDto,
} from './dto/profile.dto';
import { Business } from '../../businesses/entities/business.entity';
import { BusinessesService } from '../../businesses/businesses.service';
import { MediaService } from '../../media/media.service';
import { Specialty } from '../reference/entities/specialty.entity';
import { Condition } from '../reference/entities/condition.entity';
import { PracticeLocation } from '../practice/entities/practice-location.entity';
import { WeeklySchedule } from '../practice/entities/weekly-schedule.entity';
import { HealthEvents } from '../common/health-events';
import { ErrorCode } from '../../../common/errors/codes';
import { normalizeAccountNumber } from '../../../common/payments/payment-account.validation';
import { yearsSince } from '../common/time.util';

export const MAX_ACTIVE_ACCOUNTS = 4;
const MIN_ABOUT = 40;

const notFound = (what = 'Doctor') =>
  new NotFoundException({
    code: ErrorCode.NOT_FOUND,
    message: `${what} not found.`,
  });

const invalid = (field: string, message: string) =>
  new BadRequestException({
    code: ErrorCode.VALIDATION_FAILED,
    message,
    details: { fields: { [field]: [message] } },
  });

/** Placeholder for a doctor approved before PMDC numbers were collected. */
const unsetPmdc = (businessId: string) => `UNSET-${businessId}`;

export const accountView = (a: DoctorPaymentAccount) => ({
  id: a.id,
  kind: a.kind,
  accountTitle: a.accountTitle,
  accountNumber: a.accountNumber,
  bankName: a.bankName,
  isActive: a.isActive,
  createdAt: a.createdAt,
});

export interface Completeness {
  percent: number;
  missing: string[];
  isListed: boolean;
}

/**
 * The doctor's own profile, listing and payment accounts — plus the PMDC
 * gate on Chunk 1 onboarding: the doctor row is created when a doctor
 * business is submitted, and approval is refused until an admin has verified
 * the PMDC number.
 */
@Injectable()
export class DoctorsService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly businesses: BusinessesService,
    private readonly media: MediaService,
    private readonly events: HealthEvents,
  ) {}

  onModuleInit(): void {
    this.businesses.onSubmitted(async (m, business) => {
      if (business.subType === 'doctor')
        await this.ensureForBusiness(m, business);
    });
    this.businesses.onApproved(async (m, business) => {
      if (business.subType !== 'doctor') return;
      const doctor = await this.ensureForBusiness(m, business);
      if (!doctor.pmdcVerifiedAt) {
        throw new UnprocessableEntityException({
          code: ErrorCode.PMDC_NOT_VERIFIED,
          message: 'Verify the doctor’s PMDC registration before approving.',
          details: { doctorId: doctor.id, pmdcNumber: doctor.pmdcNumber },
        });
      }
    });
  }

  /**
   * Create or refresh the doctor row for a doctor business. A changed PMDC
   * number drops any earlier verification.
   */
  async ensureForBusiness(
    m: EntityManager,
    business: Business,
  ): Promise<{ id: string; pmdcNumber: string; pmdcVerifiedAt: Date | null }> {
    const [owner] = await m.query(
      `SELECT display_name FROM users WHERE id = $1`,
      [business.ownerUserId],
    );
    const pmdc = business.pmdcNumber ?? unsetPmdc(business.id);
    const [row] = await m.query(
      `INSERT INTO doctors (business_id, full_name, pmdc_number, languages)
       VALUES ($1, $2, $3, ARRAY['English', 'Urdu'])
       ON CONFLICT (business_id) DO UPDATE SET
         pmdc_number = CASE WHEN EXCLUDED.pmdc_number LIKE 'UNSET-%' THEN doctors.pmdc_number ELSE EXCLUDED.pmdc_number END,
         pmdc_verified_at = CASE WHEN EXCLUDED.pmdc_number LIKE 'UNSET-%' OR doctors.pmdc_number = EXCLUDED.pmdc_number
                                 THEN doctors.pmdc_verified_at ELSE NULL END,
         pmdc_verified_by = CASE WHEN EXCLUDED.pmdc_number LIKE 'UNSET-%' OR doctors.pmdc_number = EXCLUDED.pmdc_number
                                 THEN doctors.pmdc_verified_by ELSE NULL END,
         updated_at = now()
       RETURNING id, pmdc_number, pmdc_verified_at`,
      [business.id, owner?.display_name?.trim() || business.name, pmdc],
    );
    await m.query(`SELECT doctor_search_refresh($1)`, [row.id]);
    return {
      id: row.id,
      pmdcNumber: row.pmdc_number,
      pmdcVerifiedAt: row.pmdc_verified_at,
    };
  }

  /** The doctor row for an approved business (created on first use for older ones). */
  async ensureForBusinessId(businessId: string): Promise<string> {
    const [found] = await this.dataSource.query(
      `SELECT id FROM doctors WHERE business_id = $1`,
      [businessId],
    );
    if (found) return found.id;
    return this.dataSource.transaction(async (m) => {
      const business = await m.findOneByOrFail(Business, { id: businessId });
      return (await this.ensureForBusiness(m, business)).id;
    });
  }

  // ── Profile ───────────────────────────────────────────────────────────────

  async profile(doctorId: string) {
    const m = this.dataSource.manager;
    const d = await m.findOne(Doctor, { where: { id: doctorId } });
    if (!d) throw notFound();
    const [
      secondary,
      qualifications,
      experiences,
      services,
      conditions,
      specialty,
    ] = await Promise.all([
      m.find(DoctorSpecialty, { where: { doctorId } }),
      m.find(DoctorQualification, {
        where: { doctorId },
        order: { sort: 'ASC' },
      }),
      m.find(DoctorExperience, { where: { doctorId }, order: { sort: 'ASC' } }),
      m.find(DoctorServiceItem, {
        where: { doctorId },
        order: { sort: 'ASC' },
      }),
      m.query(
        `SELECT c.id, c.name, c.slug FROM doctor_conditions dc JOIN conditions c ON c.id = dc.condition_id
          WHERE dc.doctor_id = $1 ORDER BY c.name`,
        [doctorId],
      ),
      d.primarySpecialtyId
        ? m.findOneBy(Specialty, { id: d.primarySpecialtyId })
        : null,
    ]);
    return {
      id: d.id,
      title: d.title,
      fullName: d.fullName,
      gender: d.gender,
      photoUrl: d.photoUrl,
      pmdcNumber: d.pmdcNumber.startsWith('UNSET-') ? null : d.pmdcNumber,
      pmdcVerified: !!d.pmdcVerifiedAt,
      pmdcVerifiedAt: d.pmdcVerifiedAt,
      primarySpecialty: specialty
        ? {
            id: specialty.id,
            name: specialty.name,
            nameUr: specialty.nameUr,
            slug: specialty.slug,
          }
        : null,
      secondarySpecialtyIds: secondary.map((s) => s.specialtyId),
      practicingSince: d.practicingSince,
      yearsExperience: d.practicingSince ? yearsSince(d.practicingSince) : null,
      about: d.about,
      languages: d.languages,
      bookingWindowDays: d.bookingWindowDays,
      minNoticeMinutes: d.minNoticeMinutes,
      cancelCutoffMinutes: d.cancelCutoffMinutes,
      videoPrepayRequired: d.videoPrepayRequired,
      isAccepting: d.isAccepting,
      isListed: d.isListed,
      unlistedReason: d.unlistedReason,
      qualifications: qualifications.map((q) => ({
        degree: q.degree,
        institute: q.institute,
        year: q.year,
      })),
      experiences: experiences.map((e) => ({
        designation: e.designation,
        institute: e.institute,
        fromYear: e.fromYear,
        toYear: e.toYear,
      })),
      services: services.map((s) => s.name),
      conditions,
      stats: {
        ratingAvg: d.ratingAvg,
        ratingCount: d.ratingCount,
        satisfactionPct: d.satisfactionPct,
        avgWaitMinutes: d.avgWaitMinutes,
        avgConsultMinutes: d.avgConsultMinutes,
        patientsServed: d.patientsServed,
      },
      nextAvailableAt: d.nextAvailableAt,
    };
  }

  async updateProfile(
    doctorId: string,
    ownerUserId: string,
    dto: UpdateDoctorProfileDto,
  ) {
    if (dto.photoUrl)
      this.media.assertOwnedAsset(
        ownerUserId,
        'doctor_photo',
        dto.photoUrl,
        undefined,
        'photoUrl',
      );
    await this.dataSource.transaction(async (m) => {
      const d = await m.findOne(Doctor, {
        where: { id: doctorId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!d) throw notFound();

      if (dto.pmdcNumber !== undefined) {
        const pmdc = dto.pmdcNumber.trim().toUpperCase();
        if (!/^[A-Z0-9][A-Z0-9-]{2,19}$/.test(pmdc))
          throw invalid(
            'pmdcNumber',
            'Enter your PMDC registration number, e.g. 12345-P',
          );
        if (pmdc !== d.pmdcNumber) {
          if (d.pmdcVerifiedAt)
            throw invalid(
              'pmdcNumber',
              'Your PMDC number is verified; contact support to change it.',
            );
          const [taken] = await m.query(
            `SELECT 1 FROM businesses WHERE pmdc_number = $1 AND id <> $2`,
            [pmdc, d.businessId],
          );
          if (taken)
            throw new ConflictException({
              code: ErrorCode.CONFLICT,
              message:
                'This PMDC number is already registered with MetroMatrix.',
            });
          await m.update(Business, { id: d.businessId }, { pmdcNumber: pmdc });
          d.pmdcNumber = pmdc;
        }
      }
      if (dto.videoPrepayRequired === true && !d.videoPrepayRequired) {
        const accounts = await m.count(DoctorPaymentAccount, {
          where: { doctorId, isActive: true },
        });
        if (!accounts) {
          throw invalid(
            'videoPrepayRequired',
            'Add an active payment account before asking patients to pay in advance.',
          );
        }
      }
      if (dto.primarySpecialtyId !== undefined) {
        const ok = await m.exists(Specialty, {
          where: { id: dto.primarySpecialtyId, isActive: true },
        });
        if (!ok)
          throw invalid(
            'primarySpecialtyId',
            'Choose one of the MetroMatrix specialties.',
          );
        d.primarySpecialtyId = dto.primarySpecialtyId;
      }
      for (const k of [
        'title',
        'fullName',
        'gender',
        'practicingSince',
        'about',
        'languages',
        'bookingWindowDays',
        'minNoticeMinutes',
        'cancelCutoffMinutes',
        'videoPrepayRequired',
        'isAccepting',
      ] as const) {
        if (dto[k] !== undefined)
          (d as unknown as Record<string, unknown>)[k] = dto[k];
      }
      if (dto.photoUrl !== undefined) d.photoUrl = dto.photoUrl;
      if (dto.languages)
        d.languages = [...new Set(dto.languages.map((l) => l.trim()))];
      await m.save(d);

      if (dto.secondarySpecialtyIds) {
        const ids = dto.secondarySpecialtyIds.filter(
          (id) => id !== d.primarySpecialtyId,
        );
        const found = ids.length
          ? await m.count(Specialty, { where: { id: In(ids), isActive: true } })
          : 0;
        if (found !== ids.length)
          throw invalid('secondarySpecialtyIds', 'Unknown specialty.');
        await m.delete(DoctorSpecialty, { doctorId });
        if (ids.length)
          await m.insert(
            DoctorSpecialty,
            ids.map((specialtyId) => ({ doctorId, specialtyId })),
          );
      }
      if (dto.conditionIds) {
        const found = dto.conditionIds.length
          ? await m.count(Condition, {
              where: { id: In(dto.conditionIds), isActive: true },
            })
          : 0;
        if (found !== dto.conditionIds.length)
          throw invalid('conditionIds', 'Unknown condition.');
        await m.delete(DoctorCondition, { doctorId });
        if (dto.conditionIds.length)
          await m.insert(
            DoctorCondition,
            dto.conditionIds.map((conditionId) => ({ doctorId, conditionId })),
          );
      }
      if (dto.qualifications) {
        await m.delete(DoctorQualification, { doctorId });
        if (dto.qualifications.length) {
          await m.insert(
            DoctorQualification,
            dto.qualifications.map((q, sort) => ({
              doctorId,
              degree: q.degree,
              institute: q.institute,
              year: q.year ?? null,
              sort,
            })),
          );
        }
      }
      if (dto.experiences) {
        for (const e of dto.experiences) {
          if (e.toYear != null && e.toYear < e.fromYear)
            throw invalid(
              'experiences',
              'An experience can’t end before it starts.',
            );
        }
        await m.delete(DoctorExperience, { doctorId });
        if (dto.experiences.length) {
          await m.insert(
            DoctorExperience,
            dto.experiences.map((e, sort) => ({
              doctorId,
              designation: e.designation,
              institute: e.institute,
              fromYear: e.fromYear,
              toYear: e.toYear ?? null,
              sort,
            })),
          );
        }
      }
      if (dto.services) {
        await m.delete(DoctorServiceItem, { doctorId });
        const names = [...new Set(dto.services.map((s) => s.trim()))];
        if (names.length)
          await m.insert(
            DoctorServiceItem,
            names.map((name, sort) => ({ doctorId, name, sort })),
          );
      }
      await m.query(`SELECT doctor_search_refresh($1)`, [doctorId]);
      await this.enforceListing(m, doctorId);
    });
    await this.events.availabilityChanged(doctorId);
    return this.profile(doctorId);
  }

  // ── Listing ───────────────────────────────────────────────────────────────

  async completeness(
    doctorId: string,
    m: EntityManager = this.dataSource.manager,
  ): Promise<Completeness> {
    const d = await m.findOne(Doctor, { where: { id: doctorId } });
    if (!d) throw notFound();
    const [qualifications, activeLocations, ranges] = await Promise.all([
      m.count(DoctorQualification, { where: { doctorId } }),
      m.count(PracticeLocation, { where: { doctorId, isActive: true } }),
      m
        .createQueryBuilder(WeeklySchedule, 'w')
        .innerJoin(PracticeLocation, 'l', 'l.id = w.location_id')
        .where('l.doctor_id = :doctorId AND l.is_active', { doctorId })
        .getCount(),
    ]);
    const checks: Array<[string, boolean]> = [
      ['pmdc_verified', !!d.pmdcVerifiedAt],
      ['full_name', d.fullName.trim().length >= 3],
      ['gender', !!d.gender],
      ['photo', !!d.photoUrl],
      ['primary_specialty', !!d.primarySpecialtyId],
      ['practicing_since', !!d.practicingSince],
      ['about', (d.about ?? '').trim().length >= MIN_ABOUT],
      ['languages', d.languages.length > 0],
      ['qualifications', qualifications > 0],
      ['active_location', activeLocations > 0],
      ['weekly_schedule', ranges > 0],
    ];
    const missing = checks.filter(([, ok]) => !ok).map(([k]) => k);
    return {
      percent: Math.round(
        ((checks.length - missing.length) / checks.length) * 100,
      ),
      missing,
      isListed: d.isListed,
    };
  }

  async publish(doctorId: string) {
    const d = await this.dataSource.manager.findOneByOrFail(Doctor, {
      id: doctorId,
    });
    if (d.unlistedReason) {
      throw new ForbiddenException({
        code: ErrorCode.FORBIDDEN,
        message: `MetroMatrix took your profile off the directory: ${d.unlistedReason}. Contact support.`,
        details: { unlistedReason: d.unlistedReason },
      });
    }
    const c = await this.completeness(doctorId);
    if (c.missing.length) {
      throw new UnprocessableEntityException({
        code: ErrorCode.PROFILE_INCOMPLETE,
        message: 'Complete your profile before publishing it.',
        details: { percent: c.percent, missing: c.missing },
      });
    }
    await this.dataSource.manager.update(
      Doctor,
      { id: doctorId },
      { isListed: true },
    );
    await this.events.availabilityChanged(doctorId);
    return this.completeness(doctorId);
  }

  async unpublish(doctorId: string) {
    await this.dataSource.manager.update(
      Doctor,
      { id: doctorId },
      { isListed: false },
    );
    await this.events.availabilityChanged(doctorId);
    return this.completeness(doctorId);
  }

  /** A listed doctor whose profile stops being complete (last location closed…) is unlisted. */
  async enforceListing(m: EntityManager, doctorId: string): Promise<void> {
    const c = await this.completeness(doctorId, m);
    if (c.isListed && c.missing.length)
      await m.update(Doctor, { id: doctorId }, { isListed: false });
  }

  // ── Payment accounts ─────────────────────────────────────────────────────

  async listAccounts(doctorId: string) {
    const rows = await this.dataSource.manager.find(DoctorPaymentAccount, {
      where: { doctorId },
      order: { createdAt: 'ASC' },
    });
    return rows.map(accountView);
  }

  async activeAccounts(m: EntityManager, doctorId: string) {
    return m.find(DoctorPaymentAccount, {
      where: { doctorId, isActive: true },
      order: { createdAt: 'ASC' },
    });
  }

  async addAccount(doctorId: string, dto: DoctorPaymentAccountDto) {
    const norm = normalizeAccountNumber(dto.kind, dto.accountNumber);
    if (!norm.ok) throw invalid('accountNumber', norm.reason);
    if (dto.kind === 'bank' && !dto.bankName)
      throw invalid('bankName', 'Bank accounts need the bank name.');
    return this.dataSource.transaction(async (m) => {
      const active = await m.count(DoctorPaymentAccount, {
        where: { doctorId, isActive: true },
      });
      if ((dto.isActive ?? true) && active >= MAX_ACTIVE_ACCOUNTS) {
        throw invalid(
          'isActive',
          `You can have at most ${MAX_ACTIVE_ACCOUNTS} active accounts.`,
        );
      }
      if (
        await m.exists(DoctorPaymentAccount, {
          where: { doctorId, accountNumber: norm.value },
        })
      ) {
        throw new ConflictException({
          code: ErrorCode.CONFLICT,
          message: 'You already added this account.',
        });
      }
      const saved = await m.save(
        m.create(DoctorPaymentAccount, {
          doctorId,
          kind: dto.kind,
          accountTitle: dto.accountTitle,
          accountNumber: norm.value,
          bankName: dto.bankName ?? null,
          isActive: dto.isActive ?? true,
        }),
      );
      return accountView(saved);
    });
  }

  async updateAccount(
    doctorId: string,
    id: string,
    dto: UpdateDoctorPaymentAccountDto,
  ) {
    return this.dataSource.transaction(async (m) => {
      const a = await m.findOne(DoctorPaymentAccount, {
        where: { id, doctorId },
      });
      if (!a) throw notFound('Payment account');
      if (dto.isActive === true && !a.isActive) {
        const active = await m.count(DoctorPaymentAccount, {
          where: { doctorId, isActive: true },
        });
        if (active >= MAX_ACTIVE_ACCOUNTS)
          throw invalid(
            'isActive',
            `You can have at most ${MAX_ACTIVE_ACCOUNTS} active accounts.`,
          );
      }
      Object.assign(a, {
        accountTitle: dto.accountTitle ?? a.accountTitle,
        bankName: dto.bankName ?? a.bankName,
        isActive: dto.isActive ?? a.isActive,
      });
      return accountView(await m.save(a));
    });
  }

  async removeAccount(doctorId: string, id: string) {
    const res = await this.dataSource.manager.delete(DoctorPaymentAccount, {
      id,
      doctorId,
    });
    if (!res.affected) throw notFound('Payment account');
    return { removed: true };
  }
}
