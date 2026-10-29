import { ApiProperty } from '@nestjs/swagger';

/**
 * Response shapes for admin-health.controller.ts (Swagger only), checked
 * against real responses from the e2e suites.
 */

export class AdminHealthDoctorsViewDocumentsItem {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  kind!: string;
  @ApiProperty({ type: String })
  url!: string;
  @ApiProperty({ type: String })
  status!: string;
}

export class AdminHealthDoctorsViewBusiness {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String })
  status!: string;
  @ApiProperty({ type: String })
  city!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  submittedAt!: string;
}

export class AdminHealthDoctorsView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  title!: string;
  @ApiProperty({ type: String })
  fullName!: string;
  @ApiProperty({ type: String })
  pmdcNumber!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  pmdcVerifiedAt!: string | null;
  @ApiProperty({ type: Boolean })
  isListed!: boolean;
  @ApiProperty({ type: String, nullable: true })
  unlistedReason!: string | null;
  @ApiProperty({ type: String, nullable: true })
  specialty!: string | null;
  @ApiProperty({ type: () => [AdminHealthDoctorsViewDocumentsItem] })
  documents!: AdminHealthDoctorsViewDocumentsItem[];
  @ApiProperty({ type: () => AdminHealthDoctorsViewBusiness })
  business!: AdminHealthDoctorsViewBusiness;
}

export class AdminHealthClearUnlistView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String, nullable: true })
  unlistedReason!: string | null;
}

export class AdminHealthUnverifyView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: Boolean })
  pmdcVerified!: boolean;
  @ApiProperty({ type: Boolean })
  isListed!: boolean;
}

export class AdminHealthVerifyView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  pmdcNumber!: string;
  @ApiProperty({ type: Boolean })
  pmdcVerified!: boolean;
}

export class AdminHealthUnlistView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: Boolean })
  isListed!: boolean;
  @ApiProperty({ type: String })
  unlistedReason!: string;
}
