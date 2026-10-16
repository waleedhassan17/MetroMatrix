import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from '../../../common/base/base.entity';
import { User } from '../../users/entities/user.entity';
import {
  BUSINESS_STATUSES,
  BusinessStatus,
  SERVICE_TYPES,
  ServiceType,
  SUB_TYPES,
  SubType,
} from '../business-types';
import { BusinessDocument } from './business-document.entity';

/** numeric → number (pg returns numerics as strings to keep precision). */
const coordinate = {
  to: (v?: number | null) => v,
  from: (v: string | null) => (v === null ? null : parseFloat(v)),
};

/**
 * One business per partner account. A partner lists for free and is paid
 * directly by customers; an admin approves the business before it goes live.
 */
@Entity('businesses')
@Check(
  'CHK_businesses_sub_type_service',
  `("sub_type" = 'store' AND "service_type" = 'shopping')` +
    ` OR ("sub_type" = 'doctor' AND "service_type" = 'healthcare')` +
    ` OR ("sub_type" IN ('restaurant', 'home_kitchen', 'cloud_kitchen') AND "service_type" = 'food')`,
)
@Index(['status', 'createdAt'])
// A PMDC registration belongs to one doctor's business (only doctors have one).
@Index('UQ_businesses_pmdc_number', ['pmdcNumber'], {
  unique: true,
  where: '"pmdc_number" IS NOT NULL',
})
export class Business extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'uuid', name: 'owner_user_id' })
  ownerUserId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'owner_user_id' })
  owner?: User;

  @Column({
    type: 'enum',
    enum: SERVICE_TYPES,
    enumName: 'business_service_type',
    name: 'service_type',
  })
  serviceType!: ServiceType;

  @Column({
    type: 'enum',
    enum: SUB_TYPES,
    enumName: 'business_sub_type',
    name: 'sub_type',
  })
  subType!: SubType;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  /** Generated from the name plus a short suffix; unique regardless of case. */
  @Index({ unique: true })
  @Column({ type: 'citext' })
  slug!: string;

  @Column({ type: 'varchar', length: 16 })
  phone!: string;

  @Column({ type: 'varchar', length: 60 })
  city!: string;

  @Column({ type: 'varchar', length: 255, name: 'address_line' })
  addressLine!: string;

  /**
   * Doctors only: the PMDC registration number, upper-cased ("12345-P").
   * Required to submit; MetroMatrix verifies it before approval.
   */
  @Column({ type: 'citext', name: 'pmdc_number', nullable: true })
  pmdcNumber!: string | null;

  @Column({
    type: 'numeric',
    precision: 9,
    scale: 6,
    nullable: true,
    transformer: coordinate,
  })
  lat!: number | null;

  @Column({
    type: 'numeric',
    precision: 9,
    scale: 6,
    nullable: true,
    transformer: coordinate,
  })
  lng!: number | null;

  /** Written only through BusinessesService.transition (business-status.ts). */
  @Column({
    type: 'enum',
    enum: BUSINESS_STATUSES,
    enumName: 'business_status',
    default: 'draft',
  })
  status!: BusinessStatus;

  @Column({ type: 'text', name: 'rejection_reason', nullable: true })
  rejectionReason!: string | null;

  @Column({ type: 'text', name: 'suspension_reason', nullable: true })
  suspensionReason!: string | null;

  @Column({ type: 'timestamptz', name: 'submitted_at', nullable: true })
  submittedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'reviewed_at', nullable: true })
  reviewedAt!: Date | null;

  @Column({ type: 'uuid', name: 'reviewed_by', nullable: true })
  reviewedBy!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reviewed_by' })
  reviewer?: User;

  @OneToMany(() => BusinessDocument, (d) => d.business)
  documents?: BusinessDocument[];
}
