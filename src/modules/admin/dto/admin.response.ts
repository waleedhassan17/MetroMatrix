import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BUSINESS_STATUSES,
  SERVICE_TYPES,
} from '../../businesses/business-types';
import { USER_ROLES, USER_STATUSES } from '../../../types';

/** Swagger response shapes for /admin/businesses and /admin/users. */

export class BusinessOwnerView {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ nullable: true, type: String }) displayName!: string | null;
  @ApiProperty({ nullable: true, type: String }) phone!: string | null;
  @ApiProperty({ enum: USER_STATUSES }) status!: string;
  @ApiProperty() isEmailVerified!: boolean;
}

export class BusinessViewDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ enum: SERVICE_TYPES }) serviceType!: string;
  @ApiProperty() subType!: string;
  @ApiProperty({ example: 'Home kitchen' }) subTypeLabel!: string;
  @ApiProperty() phone!: string;
  @ApiProperty() city!: string;
  @ApiProperty() addressLine!: string;
  @ApiProperty({ nullable: true, type: Number }) lat!: number | null;
  @ApiProperty({ nullable: true, type: Number }) lng!: number | null;
  @ApiProperty({ enum: BUSINESS_STATUSES }) status!: string;
  @ApiProperty({ nullable: true, type: String }) rejectionReason!:
    string | null;
  @ApiProperty({ nullable: true, type: String }) suspensionReason!:
    string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  submittedAt!: Date | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  reviewedAt!: Date | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ format: 'date-time' }) updatedAt!: Date;
  @ApiProperty({ nullable: true, type: String, description: 'Doctors only.' })
  pmdcNumber!: string | null;
}

export class AdminBusinessListItemView extends BusinessViewDto {
  @ApiProperty({ type: BusinessOwnerView, nullable: true })
  owner!: BusinessOwnerView | null;
}

export class BusinessDocumentView {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'cnic_front' }) kind!: string;
  @ApiProperty({ description: 'Image or PDF.' }) url!: string;
  @ApiProperty() publicId!: string;
  @ApiProperty({ enum: ['pending', 'accepted', 'rejected'] }) status!: string;
  @ApiProperty({ nullable: true, type: String }) reviewNote!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
}

export class RequirementStatusView {
  @ApiPropertyOptional() kind?: string;
  @ApiPropertyOptional({ type: [String] }) anyOf?: string[];
  @ApiProperty() min!: number;
  @ApiProperty() have!: number;
  @ApiProperty() satisfied!: boolean;
}

export class BusinessDetailView extends BusinessViewDto {
  @ApiPropertyOptional({ description: 'Doctors only.' }) isListed?: boolean;
  @ApiPropertyOptional({ description: 'Doctors only.' }) pmdcVerified?: boolean;
  @ApiProperty({ type: [BusinessDocumentView] })
  documents!: BusinessDocumentView[];
  @ApiProperty({ type: [RequirementStatusView] })
  requiredDocuments!: RequirementStatusView[];
  @ApiProperty({ type: [String] }) missingDocuments!: string[];
}

export class BusinessHistoryItemView {
  @ApiProperty({ example: 'business.approve' }) action!: string;
  @ApiProperty({ nullable: true, type: String }) actorUserId!: string | null;
  @ApiProperty({
    nullable: true,
    type: 'object',
    additionalProperties: true,
  })
  details!: Record<string, unknown> | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
}

export class AdminBusinessDetailView extends BusinessDetailView {
  @ApiProperty({ type: BusinessOwnerView, nullable: true })
  owner!: BusinessOwnerView | null;
  @ApiProperty({ type: [BusinessHistoryItemView] })
  history!: BusinessHistoryItemView[];
}

export class AdminUserView {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ nullable: true, type: String }) displayName!: string | null;
  @ApiProperty({ enum: USER_ROLES }) role!: string;
  @ApiProperty({ nullable: true, type: String }) phone!: string | null;
  @ApiProperty({ nullable: true, type: String }) avatarUrl!: string | null;
  @ApiProperty() isEmailVerified!: boolean;
  @ApiProperty() hasPassword!: boolean;
  @ApiProperty({ enum: USER_STATUSES }) status!: string;
  @ApiProperty() totpEnabled!: boolean;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  lastLoginAt!: Date | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
}

export class AdminUserDetailView extends AdminUserView {
  @ApiProperty({ type: [BusinessViewDto] }) businesses!: BusinessViewDto[];
  @ApiProperty({ description: 'Signed-in devices (live refresh sessions).' })
  sessionCount!: number;
}
