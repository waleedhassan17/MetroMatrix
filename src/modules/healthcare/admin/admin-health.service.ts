import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Doctor } from '../doctors/entities/doctor.entity';
import { AdminDoctorQueryDto } from './dto/admin-health.dto';
import { HealthEvents } from '../common/health-events';
import { ErrorCode } from '../../../common/errors/codes';
import { paged, likeEscape } from '../../../common/pagination/pagination';
import { OperationalAuditService } from '../../../common/audit/operational-audit.service';
import { SqlParams } from '../../../common/utils/sql-params';

const notFound = () =>
  new NotFoundException({
    code: ErrorCode.NOT_FOUND,
    message: 'Doctor not found.',
  });

/** MetroMatrix staff tools for Healthcare. Every write is audited. */
@Injectable()
export class AdminHealthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: OperationalAuditService,
    private readonly events: HealthEvents,
  ) {}

  /** The verification queue and doctor lookup (pending businesses included). */
  async doctors(q: AdminDoctorQueryDto) {
    const params = new SqlParams();
    const where = ['TRUE'];
    if (q.pmdc === 'verified') where.push('d.pmdc_verified_at IS NOT NULL');
    if (q.pmdc === 'unverified') where.push('d.pmdc_verified_at IS NULL');
    if (q.businessId) where.push(`d.business_id = ${params.add(q.businessId)}`);
    if (q.q) {
      const like = params.add(`%${likeEscape(q.q)}%`);
      where.push(
        `(d.full_name ILIKE ${like} OR d.pmdc_number ILIKE ${like} OR b.name ILIKE ${like})`,
      );
    }
    const whereSql = where.join(' AND ');
    const from = `FROM doctors d JOIN businesses b ON b.id = d.business_id WHERE ${whereSql}`;
    const [{ total }] = await this.dataSource.query(
      `SELECT count(*)::int AS total ${from}`,
      params.values,
    );
    const rows = await this.dataSource.query(
      `SELECT d.id, d.full_name, d.title, d.pmdc_number, d.pmdc_verified_at, d.is_listed, d.unlisted_reason,
              b.id AS business_id, b.name AS business_name, b.status AS business_status, b.city, b.submitted_at,
              s.id AS sp_id, s.name AS sp_name, s.slug AS sp_slug,
              coalesce((SELECT json_agg(json_build_object('id', bd.id, 'kind', bd.kind, 'url', bd.url, 'status', bd.status) ORDER BY bd.created_at)
                          FROM business_documents bd WHERE bd.business_id = b.id), '[]') AS documents
         ${from.replace('WHERE', 'LEFT JOIN specialties s ON s.id = d.primary_specialty_id WHERE')}
        ORDER BY (d.pmdc_verified_at IS NULL) DESC, b.submitted_at ASC NULLS LAST, d.id
        LIMIT ${params.add(q.pageSize)} OFFSET ${params.add((q.page - 1) * q.pageSize)}`,
      params.values,
    );
    return paged(
      rows.map((r: any) => ({
        id: r.id,
        title: r.title,
        fullName: r.full_name,
        pmdcNumber: r.pmdc_number.startsWith('UNSET-') ? null : r.pmdc_number,
        pmdcVerifiedAt: r.pmdc_verified_at,
        isListed: r.is_listed,
        unlistedReason: r.unlisted_reason,
        specialty: r.sp_id
          ? { id: r.sp_id, name: r.sp_name, slug: r.sp_slug }
          : null,
        // The registration certificate and anything else the doctor uploaded at sign-up.
        documents: r.documents,
        business: {
          id: r.business_id,
          name: r.business_name,
          status: r.business_status,
          city: r.city,
          submittedAt: r.submitted_at,
        },
      })),
      total,
      q,
    );
  }

  async pmdcVerify(adminId: string, id: string, note: string | null) {
    const d = await this.dataSource.manager.findOne(Doctor, { where: { id } });
    if (!d) throw notFound();
    if (d.pmdcNumber.startsWith('UNSET-')) {
      throw new ConflictException({
        code: ErrorCode.CONFLICT,
        message: 'This doctor has not given a PMDC number yet.',
      });
    }
    await this.dataSource.manager.update(
      Doctor,
      { id },
      { pmdcVerifiedAt: new Date(), pmdcVerifiedBy: adminId },
    );
    await this.audit.record({
      action: 'health.doctor.pmdc_verify',
      targetType: 'doctor',
      targetId: id,
      details: { pmdcNumber: d.pmdcNumber, note },
      before: { pmdcVerified: !!d.pmdcVerifiedAt },
      after: { pmdcVerified: true },
    });
    return { id, pmdcNumber: d.pmdcNumber, pmdcVerified: true };
  }

  /** Withdraw verification — the doctor is also taken off the directory. */
  async pmdcUnverify(id: string, reason: string) {
    const before = await this.state(id);
    await this.dataSource.manager.update(
      Doctor,
      { id },
      { pmdcVerifiedAt: null, pmdcVerifiedBy: null, isListed: false },
    );
    await this.audit.record({
      action: 'health.doctor.pmdc_unverify',
      targetType: 'doctor',
      targetId: id,
      details: { reason },
      before,
      after: { ...before, pmdcVerified: false, isListed: false },
    });
    await this.events.availabilityChanged(id);
    return { id, pmdcVerified: false, isListed: false };
  }

  /** Take a doctor off the directory; they can't republish until support clears it. */
  async unlist(id: string, reason: string) {
    const before = await this.state(id);
    await this.dataSource.manager.update(
      Doctor,
      { id },
      { isListed: false, unlistedReason: reason },
    );
    await this.audit.record({
      action: 'health.doctor.unlist',
      targetType: 'doctor',
      targetId: id,
      before,
      after: { ...before, isListed: false, unlistedReason: reason },
    });
    await this.events.availabilityChanged(id);
    return { id, isListed: false, unlistedReason: reason };
  }

  /** Clear an admin unlisting (the doctor republishes themselves). */
  async clearUnlist(id: string) {
    const before = await this.state(id);
    await this.dataSource.manager.update(
      Doctor,
      { id },
      { unlistedReason: null },
    );
    await this.audit.record({
      action: 'health.doctor.clear_unlist',
      targetType: 'doctor',
      targetId: id,
      before,
      after: { ...before, unlistedReason: null },
    });
    return { id, unlistedReason: null };
  }

  /** The fields these actions change, before one of them (404 if no doctor). */
  private async state(id: string) {
    const d = await this.dataSource.manager.findOne(Doctor, {
      where: { id },
      select: {
        id: true,
        pmdcVerifiedAt: true,
        isListed: true,
        unlistedReason: true,
      },
    });
    if (!d) throw notFound();
    return {
      pmdcVerified: !!d.pmdcVerifiedAt,
      isListed: d.isListed,
      unlistedReason: d.unlistedReason,
    };
  }
}
