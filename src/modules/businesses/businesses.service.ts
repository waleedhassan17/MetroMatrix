import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { Business } from './entities/business.entity';
import { BusinessDocument } from './entities/business-document.entity';
import {
  BusinessStatus,
  EDITABLE_STATUSES,
  MAX_PER_MULTI_KIND,
  MULTI_KINDS,
  SUBTYPE_SERVICE,
} from './business-types';
import {
  ALLOWED_KINDS,
  evaluateDocuments,
  RequirementStatus,
} from './required-documents';
import { assertTransition, invalidTransition } from './business-status';
import {
  AddDocumentDto,
  CreateBusinessDto,
  UpdateBusinessDto,
} from './dto/business.dto';
import { MediaService } from '../media/media.service';
import { AccountService } from '../auth/account.service';
import { User } from '../users/entities/user.entity';
import { OperationalAuditService } from '../../common/audit/operational-audit.service';
import { ErrorCode } from '../../common/errors/codes';
import { isUniqueViolation } from '../auth/auth.service';

export interface BusinessView {
  id: string;
  name: string;
  slug: string;
  serviceType: string;
  subType: string;
  phone: string;
  city: string;
  addressLine: string;
  lat: number | null;
  lng: number | null;
  status: BusinessStatus;
  rejectionReason: string | null;
  suspensionReason: string | null;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DocumentView {
  id: string;
  kind: string;
  url: string;
  publicId: string;
  status: string;
  reviewNote: string | null;
  createdAt: Date;
}

export interface BusinessDetail extends BusinessView {
  documents: DocumentView[];
  requiredDocuments: RequirementStatus[];
  missingDocuments: string[];
}

export const toBusinessView = (b: Business): BusinessView => ({
  id: b.id,
  name: b.name,
  slug: b.slug,
  serviceType: b.serviceType,
  subType: b.subType,
  phone: b.phone,
  city: b.city,
  addressLine: b.addressLine,
  lat: b.lat,
  lng: b.lng,
  status: b.status,
  rejectionReason: b.rejectionReason,
  suspensionReason: b.suspensionReason,
  submittedAt: b.submittedAt,
  reviewedAt: b.reviewedAt,
  createdAt: b.createdAt,
  updatedAt: b.updatedAt,
});

export const toDocumentView = (d: BusinessDocument): DocumentView => ({
  id: d.id,
  kind: d.kind,
  url: d.url,
  publicId: d.publicId,
  status: d.status,
  reviewNote: d.reviewNote,
  createdAt: d.createdAt,
});

/** "Dr. Sana's Clinic!" → "dr-sanas-clinic" (≤ 60 chars, never empty). */
export function slugify(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return base || 'business';
}

const slugSuffix = () => randomBytes(3).toString('hex').slice(0, 5);

const notEditable = (status: BusinessStatus) =>
  new ConflictException({
    code: ErrorCode.BUSINESS_NOT_EDITABLE,
    message:
      status === 'pending_approval'
        ? 'Your business is under review and cannot be changed right now.'
        : 'Your business can no longer be changed here. Contact support.',
    details: { status },
  });

@Injectable()
export class BusinessesService implements OnModuleInit {
  constructor(
    @InjectRepository(Business)
    private readonly repo: Repository<Business>,
    @InjectRepository(BusinessDocument)
    private readonly docs: Repository<BusinessDocument>,
    private readonly dataSource: DataSource,
    private readonly media: MediaService,
    private readonly account: AccountService,
    private readonly audit: OperationalAuditService,
  ) {}

  onModuleInit(): void {
    this.account.onAccountDeleted((m, user) => this.onOwnerDeleted(m, user));
  }

  // ── Partner: their own business ───────────────────────────────────────────

  async create(
    ownerUserId: string,
    dto: CreateBusinessDto,
  ): Promise<BusinessDetail> {
    if (await this.repo.exists({ where: { ownerUserId } })) throw this.exists();

    for (let attempt = 0; ; attempt++) {
      const business = this.repo.create({
        ownerUserId,
        serviceType: dto.serviceType,
        subType: dto.subType,
        name: dto.name,
        slug: `${slugify(dto.name)}-${slugSuffix()}`,
        phone: dto.phone,
        city: dto.city,
        addressLine: dto.addressLine,
        lat: dto.lat ?? null,
        lng: dto.lng ?? null,
        status: 'draft',
      });
      try {
        const saved = await this.repo.save(business);
        await this.audit.record({
          action: 'business.create',
          targetType: 'business',
          targetId: saved.id,
          details: { serviceType: saved.serviceType, subType: saved.subType },
        });
        return this.detail(saved);
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        // Owner race (a double-tap) → the business already exists. A slug
        // collision → try another suffix.
        if (await this.repo.exists({ where: { ownerUserId } }))
          throw this.exists();
        if (attempt >= 3) throw err;
      }
    }
  }

  async getMine(ownerUserId: string): Promise<BusinessDetail> {
    return this.detail(await this.mine(ownerUserId));
  }

  async updateMine(
    ownerUserId: string,
    dto: UpdateBusinessDto,
  ): Promise<BusinessDetail> {
    const business = await this.mine(ownerUserId);
    if (!EDITABLE_STATUSES.includes(business.status)) {
      throw notEditable(business.status);
    }

    const typeChange =
      (dto.serviceType !== undefined &&
        dto.serviceType !== business.serviceType) ||
      (dto.subType !== undefined && dto.subType !== business.subType);
    if (typeChange) {
      if (business.status !== 'draft') {
        throw new BadRequestException({
          code: ErrorCode.VALIDATION_FAILED,
          message:
            'The type of business can only be changed before it is first submitted.',
        });
      }
      const serviceType = dto.serviceType ?? business.serviceType;
      const subType = dto.subType ?? business.subType;
      if (SUBTYPE_SERVICE[subType] !== serviceType) {
        const message = `A ${subType} belongs to the ${SUBTYPE_SERVICE[subType]} service`;
        throw new BadRequestException({
          code: ErrorCode.VALIDATION_FAILED,
          message,
          details: { fields: { subType: [message] } },
        });
      }
      business.serviceType = serviceType;
      business.subType = subType;
    }

    if (dto.name !== undefined && dto.name !== business.name) {
      business.name = dto.name;
      business.slug = `${slugify(dto.name)}-${slugSuffix()}`;
    }
    if (dto.phone !== undefined) business.phone = dto.phone;
    if (dto.city !== undefined) business.city = dto.city;
    if (dto.addressLine !== undefined) business.addressLine = dto.addressLine;
    if (dto.lat !== undefined) business.lat = dto.lat;
    if (dto.lng !== undefined) business.lng = dto.lng;

    const saved = await this.repo.save(business);
    return this.detail(saved);
  }

  async addDocument(
    ownerUserId: string,
    dto: AddDocumentDto,
  ): Promise<DocumentView> {
    const business = await this.mine(ownerUserId);
    if (!EDITABLE_STATUSES.includes(business.status)) {
      throw notEditable(business.status);
    }
    if (!ALLOWED_KINDS[business.subType].includes(dto.kind)) {
      const message = `A ${business.subType.replace('_', ' ')} does not need a ${dto.kind}.`;
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message,
        details: {
          fields: { kind: [message] },
          allowed: ALLOWED_KINDS[business.subType],
        },
      });
    }
    this.media.assertOwnedAsset(
      ownerUserId,
      'business_document',
      dto.url,
      dto.publicId,
    );

    const saved = await this.dataSource.transaction(async (m) => {
      if (MULTI_KINDS.includes(dto.kind)) {
        const count = await m.count(BusinessDocument, {
          where: { businessId: business.id, kind: dto.kind },
        });
        if (count >= MAX_PER_MULTI_KIND) {
          throw new BadRequestException({
            code: ErrorCode.VALIDATION_FAILED,
            message: `At most ${MAX_PER_MULTI_KIND} ${dto.kind.replace('_', ' ')}s. Remove one first.`,
          });
        }
      } else {
        // One per kind: a new upload replaces the old one (the fix after a
        // rejection is "upload a clearer CNIC", not "delete, then upload").
        await m.delete(BusinessDocument, {
          businessId: business.id,
          kind: dto.kind,
        });
      }
      return m.save(
        m.create(BusinessDocument, {
          businessId: business.id,
          kind: dto.kind,
          url: dto.url.trim(),
          publicId: dto.publicId.trim(),
          status: 'pending',
          reviewNote: null,
        }),
      );
    });
    return toDocumentView(saved);
  }

  async removeDocument(
    ownerUserId: string,
    documentId: string,
  ): Promise<{ removed: true }> {
    const business = await this.mine(ownerUserId);
    if (!EDITABLE_STATUSES.includes(business.status)) {
      throw notEditable(business.status);
    }
    const res = await this.docs.delete({
      id: documentId,
      businessId: business.id,
    });
    if (!res.affected) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Document not found.',
      });
    }
    return { removed: true };
  }

  /** draft / rejected → pending_approval, once every required document is in. */
  async submit(ownerUserId: string): Promise<BusinessDetail> {
    const business = await this.mine(ownerUserId);
    assertTransition(business.status, 'pending_approval');

    const documents = await this.docs.find({
      where: { businessId: business.id },
    });
    const { missing, requirements } = evaluateDocuments(
      business.subType,
      documents,
    );
    if (missing.length) {
      throw new UnprocessableEntityException({
        code: ErrorCode.DOCUMENTS_MISSING,
        message: 'Upload the required documents before submitting.',
        details: { missing, requirements },
      });
    }

    const from = business.status;
    await this.transition(this.repo.manager, business, 'pending_approval', {
      submittedAt: new Date(),
      rejectionReason: null,
    });
    await this.audit.record({
      action: 'business.submit',
      targetType: 'business',
      targetId: business.id,
      details: { from, resubmission: from === 'rejected' },
    });
    return this.detail(business, documents);
  }

  /** The waiting screen polls this, so it is one narrow row. */
  async statusOf(ownerUserId: string) {
    const row = await this.repo.findOne({
      where: { ownerUserId },
      select: {
        id: true,
        status: true,
        rejectionReason: true,
        suspensionReason: true,
      },
    });
    if (!row) throw this.notFound();
    return {
      status: row.status,
      rejectionReason: row.rejectionReason,
      suspensionReason: row.suspensionReason,
    };
  }

  // ── Shared with admin ─────────────────────────────────────────────────────

  /**
   * The only way a business changes status. The map in business-status.ts
   * decides what is legal; the conditional UPDATE makes a concurrent change
   * (two admins, admin vs. resubmit) lose cleanly with INVALID_TRANSITION.
   */
  async transition(
    manager: EntityManager,
    business: Business,
    to: BusinessStatus,
    patch: QueryDeepPartialEntity<Business> = {},
  ): Promise<void> {
    const from = business.status;
    assertTransition(from, to);
    const res = await manager
      .createQueryBuilder()
      .update(Business)
      .set({ ...patch, status: to })
      .where('id = :id AND status = :from', { id: business.id, from })
      .execute();
    if (!res.affected) throw invalidTransition(from, to);
    Object.assign(business, patch, { status: to });
  }

  async detail(
    business: Business,
    documents?: BusinessDocument[],
  ): Promise<BusinessDetail> {
    const docs =
      documents ??
      (await this.docs.find({
        where: { businessId: business.id },
        order: { createdAt: 'ASC' },
      }));
    const { requirements, missing } = evaluateDocuments(business.subType, docs);
    return {
      ...toBusinessView(business),
      documents: docs.map(toDocumentView),
      requiredDocuments: requirements,
      missingDocuments: missing,
    };
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private async mine(ownerUserId: string): Promise<Business> {
    const business = await this.repo.findOne({ where: { ownerUserId } });
    if (!business) throw this.notFound();
    return business;
  }

  /**
   * An owner deleting their account takes their business out of circulation:
   * a live one is suspended, one under review is rejected — both through the
   * transition map, inside the deletion transaction.
   */
  private async onOwnerDeleted(m: EntityManager, user: User): Promise<void> {
    const business = await m.findOne(Business, {
      where: { ownerUserId: user.id },
    });
    if (!business) return;
    const reason = 'Owner account deleted';
    if (business.status === 'approved') {
      await this.transition(m, business, 'suspended', {
        suspensionReason: reason,
      });
    } else if (business.status === 'pending_approval') {
      await this.transition(m, business, 'rejected', {
        rejectionReason: reason,
      });
    }
  }

  private exists() {
    return new ConflictException({
      code: ErrorCode.BUSINESS_EXISTS,
      message:
        'You already have a business. One partner account runs one business.',
    });
  }

  private notFound() {
    return new NotFoundException({
      code: ErrorCode.NOT_FOUND,
      message: 'You have not set up a business yet.',
    });
  }
}
