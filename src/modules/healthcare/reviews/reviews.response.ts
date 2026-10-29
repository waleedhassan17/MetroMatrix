import { ApiProperty } from '@nestjs/swagger';

/**
 * Response shapes for reviews.controller.ts (Swagger only), checked
 * against real responses from the e2e suites.
 */

export class AdminReviewsListViewReply {
  @ApiProperty({ type: String })
  text!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  at!: string;
}

export class AdminReviewsListView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  author!: string;
  @ApiProperty({ type: Boolean })
  isAnonymous!: boolean;
  @ApiProperty({ type: Boolean })
  verifiedVisit!: boolean;
  @ApiProperty({ type: String })
  kind!: string;
  @ApiProperty({ type: 'integer' })
  overall!: number;
  @ApiProperty({ type: 'integer' })
  diagnosis!: number;
  @ApiProperty({ type: 'integer', nullable: true })
  staff!: number | null;
  @ApiProperty({ type: 'integer', nullable: true })
  environment!: number | null;
  @ApiProperty({ type: Boolean })
  recommend!: boolean;
  @ApiProperty({ type: [String] })
  tags!: string[];
  @ApiProperty({ type: String })
  text!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: () => AdminReviewsListViewReply, nullable: true })
  reply!: AdminReviewsListViewReply | null;
  @ApiProperty({ type: String })
  appointmentCode!: string;
  @ApiProperty({ type: Boolean })
  hidden!: boolean;
  @ApiProperty({ type: String, nullable: true })
  hiddenReason!: string | null;
  @ApiProperty({ type: String })
  doctorId!: string;
  @ApiProperty({ type: String })
  doctorName!: string;
  @ApiProperty({ type: String })
  patientUserId!: string;
  @ApiProperty({ type: String })
  authorName!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  hiddenAt!: string | null;
}

export class AdminReviewsHideViewReply {
  @ApiProperty({ type: String })
  text!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  at!: string;
}

export class AdminReviewsHideView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  author!: string;
  @ApiProperty({ type: Boolean })
  isAnonymous!: boolean;
  @ApiProperty({ type: Boolean })
  verifiedVisit!: boolean;
  @ApiProperty({ type: String })
  kind!: string;
  @ApiProperty({ type: 'integer' })
  overall!: number;
  @ApiProperty({ type: 'integer' })
  diagnosis!: number;
  @ApiProperty({ type: String, nullable: true })
  staff!: string | null;
  @ApiProperty({ type: String, nullable: true })
  environment!: string | null;
  @ApiProperty({ type: Boolean })
  recommend!: boolean;
  @ApiProperty({ type: [String] })
  tags!: string[];
  @ApiProperty({ type: String })
  text!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: () => AdminReviewsHideViewReply })
  reply!: AdminReviewsHideViewReply;
  @ApiProperty({ type: String, nullable: true })
  appointmentCode!: string | null;
  @ApiProperty({ type: Boolean })
  hidden!: boolean;
  @ApiProperty({ type: String })
  hiddenReason!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  hiddenAt!: string;
}

export class AdminReviewsUnhideViewReply {
  @ApiProperty({ type: String })
  text!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  at!: string;
}

export class AdminReviewsUnhideView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  author!: string;
  @ApiProperty({ type: Boolean })
  isAnonymous!: boolean;
  @ApiProperty({ type: Boolean })
  verifiedVisit!: boolean;
  @ApiProperty({ type: String })
  kind!: string;
  @ApiProperty({ type: 'integer' })
  overall!: number;
  @ApiProperty({ type: 'integer' })
  diagnosis!: number;
  @ApiProperty({ type: String, nullable: true })
  staff!: string | null;
  @ApiProperty({ type: String, nullable: true })
  environment!: string | null;
  @ApiProperty({ type: Boolean })
  recommend!: boolean;
  @ApiProperty({ type: [String] })
  tags!: string[];
  @ApiProperty({ type: String })
  text!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: () => AdminReviewsUnhideViewReply })
  reply!: AdminReviewsUnhideViewReply;
  @ApiProperty({ type: String, nullable: true })
  appointmentCode!: string | null;
  @ApiProperty({ type: Boolean })
  hidden!: boolean;
  @ApiProperty({ type: String, nullable: true })
  hiddenReason!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  hiddenAt!: string | null;
}
