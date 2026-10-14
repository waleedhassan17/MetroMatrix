import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/base/base.entity';
import {
  DOCUMENT_KINDS,
  DOCUMENT_STATUSES,
  DocumentKind,
  DocumentStatus,
} from '../business-types';
import { Business } from './business.entity';

/**
 * A verification document the partner uploaded straight to Cloudinary (see
 * MediaService); we store where it lives, never the file.
 *
 * One per kind, except shop and kitchen photos (up to 4 — enforced by the
 * service). The partial unique index makes "one per kind" race-proof.
 */
@Entity('business_documents')
@Index('UQ_business_documents_single_kind', ['businessId', 'kind'], {
  unique: true,
  where: `"kind" NOT IN ('kitchen_photo', 'shop_photo')`,
})
@Index(['businessId'])
export class BusinessDocument extends BaseEntity {
  @Column({ type: 'uuid', name: 'business_id' })
  businessId!: string;

  @ManyToOne(() => Business, (b) => b.documents, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'business_id' })
  business?: Business;

  @Column({
    type: 'enum',
    enum: DOCUMENT_KINDS,
    enumName: 'business_document_kind',
  })
  kind!: DocumentKind;

  @Column({ type: 'varchar', length: 500 })
  url!: string;

  @Column({ type: 'varchar', length: 255, name: 'public_id' })
  publicId!: string;

  @Column({
    type: 'enum',
    enum: DOCUMENT_STATUSES,
    enumName: 'business_document_status',
    default: 'pending',
  })
  status!: DocumentStatus;

  /** The admin's note when a document is rejected ("blurry", "expired"). */
  @Column({ type: 'text', name: 'review_note', nullable: true })
  reviewNote!: string | null;
}
