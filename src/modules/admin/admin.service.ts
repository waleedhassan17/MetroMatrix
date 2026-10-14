import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Business } from '../businesses/entities/business.entity';
import { BusinessDocument } from '../businesses/entities/business-document.entity';
import {
  BusinessDetail,
  BusinessesService,
  toBusinessView,
} from '../businesses/businesses.service';
import { DOCUMENT_LABELS, DocumentKind } from '../businesses/business-types';
import { User } from '../users/entities/user.entity';
import { TokenService } from '../auth/token.service';
import { toAuthUser } from '../auth/auth-result';
import { MailService } from '../mail/mail.service';
import { OperationalAuditService } from '../../common/audit/operational-audit.service';
import { ErrorCode } from '../../common/errors/codes';
import { likeEscape, paged } from '../../common/pagination/pagination';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { isAdminRole } from '../../types';
import {
  AdminBusinessQueryDto,
  AdminUserQueryDto,
  RejectBusinessDto,
} from './dto/admin.dto';

const ownerView = (u: User | undefined) =>
  u
    ? {
        id: u.id,
        email: u.email,
        displayName: u.displayName,
        phone: u.phone,
        status: u.status,
        isEmailVerified: u.isEmailVerified,
      }
    : null;

/**
 * The platform console: review partner businesses, manage accounts. Every
 * write is audited, and every business decision is emailed to its owner.
 */
@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(Business)
    private readonly businesses: Repository<Business>,
    @InjectRepository(BusinessDocument)
    private readonly documents: Repository<BusinessDocument>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly businessesService: BusinessesService,
    private readonly tokens: TokenService,
    private readonly mail: MailService,
    private readonly audit: OperationalAuditService,
    private readonly dataSource: DataSource,
  ) {}

  // ── Businesses ────────────────────────────────────────────────────────────

  async listBusinesses(q: AdminBusinessQueryDto) {
    const qb = this.businesses
      .createQueryBuilder('b')
      .leftJoinAndSelect('b.owner', 'o');
    if (q.status) qb.andWhere('b.status = :status', { status: q.status });
    if (q.serviceType) {
      qb.andWhere('b.service_type = :serviceType', {
        serviceType: q.serviceType,
      });
    }
    if (q.q) {
      qb.andWhere(
        '(b.name ILIKE :q OR b.slug ILIKE :q OR b.city ILIKE :q OR o.email ILIKE :q)',
        { q: `%${likeEscape(q.q)}%` },
      );
    }
    // The review queue reads oldest submission first; everything else newest.
    // Property names, not columns: skip/take with a join pages through a
    // DISTINCT subquery that only understands entity paths.
    if (q.status === 'pending_approval') {
      qb.orderBy('b.submittedAt', 'ASC', 'NULLS LAST');
    } else {
      qb.orderBy('b.createdAt', 'DESC');
    }
    const [rows, total] = await qb
      .addOrderBy('b.id', 'ASC')
      .skip((q.page - 1) * q.pageSize)
      .take(q.pageSize)
      .getManyAndCount();
    return paged(
      rows.map((b) => ({ ...toBusinessView(b), owner: ownerView(b.owner) })),
      total,
      q,
    );
  }

  async getBusiness(id: string) {
    const business = await this.findBusiness(id);
    const detail = await this.businessesService.detail(business);
    const history = await this.audit.listForTarget('business', id);
    return {
      ...detail,
      owner: ownerView(business.owner),
      history: history.map((h) => ({
        action: h.action,
        actorUserId: h.actorUserId,
        details: h.details,
        createdAt: h.createdAt,
      })),
    };
  }

  /** pending_approval → approved. Documents still pending are accepted. */
  async approve(admin: AuthenticatedUser, id: string): Promise<BusinessDetail> {
    const business = await this.findBusiness(id);
    await this.dataSource.transaction(async (m) => {
      await this.businessesService.transition(m, business, 'approved', {
        reviewedAt: new Date(),
        reviewedBy: admin.id,
        rejectionReason: null,
      });
      await m.update(
        BusinessDocument,
        { businessId: business.id, status: 'pending' },
        { status: 'accepted' },
      );
    });
    await this.audit.record({
      action: 'business.approve',
      targetType: 'business',
      targetId: business.id,
    });
    await this.notifyOwner(business, (to, name) =>
      this.mail.sendBusinessApproved(to, name, business.name),
    );
    return this.businessesService.detail(business);
  }

  /** pending_approval → rejected, with a reason and optional per-document notes. */
  async reject(
    admin: AuthenticatedUser,
    id: string,
    dto: RejectBusinessDto,
  ): Promise<BusinessDetail> {
    const business = await this.findBusiness(id);
    const notes = dto.documentNotes ?? [];
    const docs = notes.length
      ? await this.documents.find({
          where: {
            businessId: business.id,
            id: In(notes.map((n) => n.documentId)),
          },
        })
      : [];
    const unknown = notes.filter(
      (n) => !docs.some((d) => d.id === n.documentId),
    );
    if (unknown.length) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message:
          'Some document notes refer to documents this business does not have.',
        details: { documentIds: unknown.map((n) => n.documentId) },
      });
    }

    await this.dataSource.transaction(async (m) => {
      await this.businessesService.transition(m, business, 'rejected', {
        rejectionReason: dto.reason,
        reviewedAt: new Date(),
        reviewedBy: admin.id,
      });
      for (const n of notes) {
        await m.update(
          BusinessDocument,
          { id: n.documentId },
          { status: 'rejected', reviewNote: n.note },
        );
      }
    });
    await this.audit.record({
      action: 'business.reject',
      targetType: 'business',
      targetId: business.id,
      details: { reason: dto.reason, documentNotes: notes },
    });
    const labelled = notes.map((n) => ({
      label:
        DOCUMENT_LABELS[
          docs.find((d) => d.id === n.documentId)!.kind as DocumentKind
        ],
      note: n.note,
    }));
    await this.notifyOwner(business, (to, name) =>
      this.mail.sendBusinessRejected(
        to,
        name,
        business.name,
        dto.reason,
        labelled,
      ),
    );
    return this.businessesService.detail(business);
  }

  /** approved → suspended. Takes effect on the partner's next request. */
  async suspend(admin: AuthenticatedUser, id: string, reason: string) {
    const business = await this.findBusiness(id);
    await this.businessesService.transition(
      this.dataSource.manager,
      business,
      'suspended',
      {
        suspensionReason: reason,
        reviewedAt: new Date(),
        reviewedBy: admin.id,
      },
    );
    await this.audit.record({
      action: 'business.suspend',
      targetType: 'business',
      targetId: business.id,
      details: { reason },
    });
    await this.notifyOwner(business, (to, name) =>
      this.mail.sendBusinessSuspended(to, name, business.name, reason),
    );
    return this.businessesService.detail(business);
  }

  /** suspended → approved. */
  async reinstate(admin: AuthenticatedUser, id: string, reason: string) {
    const business = await this.findBusiness(id);
    await this.businessesService.transition(
      this.dataSource.manager,
      business,
      'approved',
      {
        suspensionReason: null,
        reviewedAt: new Date(),
        reviewedBy: admin.id,
      },
    );
    await this.audit.record({
      action: 'business.reinstate',
      targetType: 'business',
      targetId: business.id,
      details: { reason },
    });
    await this.notifyOwner(business, (to, name) =>
      this.mail.sendBusinessApproved(to, name, business.name, {
        reinstated: true,
      }),
    );
    return this.businessesService.detail(business);
  }

  // ── Users ─────────────────────────────────────────────────────────────────

  async listUsers(q: AdminUserQueryDto) {
    const qb = this.users.createQueryBuilder('u');
    if (q.role) qb.andWhere('u.role = :role', { role: q.role });
    if (q.status) qb.andWhere('u.status = :status', { status: q.status });
    else qb.andWhere(`u.status <> 'deleted'`);
    if (q.q) {
      qb.andWhere(
        '(u.email ILIKE :q OR u.display_name ILIKE :q OR u.phone ILIKE :q)',
        { q: `%${likeEscape(q.q)}%` },
      );
    }
    const [rows, total] = await qb
      .orderBy('u.createdAt', 'DESC')
      .addOrderBy('u.id', 'ASC')
      .skip((q.page - 1) * q.pageSize)
      .take(q.pageSize)
      .getManyAndCount();
    return paged(
      rows.map((u) => this.userView(u)),
      total,
      q,
    );
  }

  /** Signs the account out everywhere, at once. */
  async disableUser(actor: AuthenticatedUser, id: string, reason?: string) {
    const target = await this.findUser(id);
    this.assertMayManage(actor, target);
    if (target.status === 'active') {
      await this.dataSource.transaction(async (m) => {
        await m.update(
          User,
          { id: target.id },
          { status: 'disabled', tokenVersion: () => 'token_version + 1' },
        );
        await this.tokens.revokeAllForUser(target.id, undefined, m);
      });
      target.status = 'disabled';
      await this.audit.record({
        action: 'user.disable',
        targetType: 'user',
        targetId: target.id,
        details: { reason: reason ?? null },
      });
    }
    return this.userView(target);
  }

  async enableUser(actor: AuthenticatedUser, id: string) {
    const target = await this.findUser(id);
    this.assertMayManage(actor, target);
    if (target.status === 'disabled') {
      await this.users.update({ id: target.id }, { status: 'active' });
      target.status = 'active';
      await this.audit.record({
        action: 'user.enable',
        targetType: 'user',
        targetId: target.id,
      });
    }
    return this.userView(target);
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private userView(u: User) {
    return {
      ...toAuthUser(u),
      status: u.status,
      totpEnabled: u.totpEnabled,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
    };
  }

  /** Nobody disables themselves; only a super admin touches another admin. */
  private assertMayManage(actor: AuthenticatedUser, target: User): void {
    if (actor.id === target.id) {
      throw new ForbiddenException({
        code: ErrorCode.FORBIDDEN,
        message: 'You cannot change the status of your own account.',
      });
    }
    if (isAdminRole(target.role) && actor.role !== 'super_admin') {
      throw new ForbiddenException({
        code: ErrorCode.FORBIDDEN,
        message: 'Only a super admin can change another admin’s account.',
      });
    }
  }

  private async findBusiness(id: string): Promise<Business> {
    const business = await this.businesses.findOne({
      where: { id },
      relations: { owner: true },
    });
    if (!business) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Business not found.',
      });
    }
    return business;
  }

  private async findUser(id: string): Promise<User> {
    const user = await this.users.findOne({ where: { id } });
    if (!user || user.status === 'deleted') {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'User not found.',
      });
    }
    return user;
  }

  private async notifyOwner(
    business: Business,
    send: (to: string, name: string | null) => Promise<void>,
  ): Promise<void> {
    const owner = business.owner;
    if (owner && owner.status !== 'deleted') {
      await send(owner.email, owner.displayName);
    }
  }
}
