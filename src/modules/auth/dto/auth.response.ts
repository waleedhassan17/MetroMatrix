import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { USER_ROLES } from '../../../types';
import { ADMIN_PERMISSION_KEYS } from '../../../types/admin-permissions';

/** Swagger response shapes for the auth endpoints the console calls. */

export class AuthUserView {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ nullable: true, type: String }) displayName!: string | null;
  @ApiProperty({ enum: USER_ROLES }) role!: string;
  @ApiProperty({ nullable: true, type: String }) phone!: string | null;
  @ApiProperty({ nullable: true, type: String }) avatarUrl!: string | null;
  @ApiProperty() isEmailVerified!: boolean;
  @ApiProperty() hasPassword!: boolean;
}

export class BusinessSummaryView {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() serviceType!: string;
  @ApiProperty() subType!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ nullable: true, type: String }) rejectionReason!:
    string | null;
  @ApiProperty({ nullable: true, type: String }) suspensionReason!:
    string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  submittedAt!: Date | null;
}

export class AdminSessionViewDto {
  @ApiProperty() isSuperAdmin!: boolean;
  @ApiProperty({
    enum: ADMIN_PERMISSION_KEYS,
    isArray: true,
    description: 'Effective: a super admin lists every key.',
  })
  permissions!: string[];
  @ApiProperty({
    description:
      'True: only /auth/me and change-password work until it is changed.',
  })
  mustChangePassword!: boolean;
  @ApiProperty() totpEnabled!: boolean;
  @ApiProperty() recoveryCodesRemaining!: number;
}

export class TokenPairView {
  @ApiProperty() accessToken!: string;
  @ApiPropertyOptional({
    description:
      'Absent for the web console (X-Client: admin-web): it is set as the HttpOnly mm_admin_rt cookie instead.',
  })
  refreshToken?: string;
  @ApiProperty({ description: 'Access-token lifetime in seconds.' })
  expiresIn!: number;
}

export class AccountViewDto {
  @ApiProperty({ type: AuthUserView }) user!: AuthUserView;
  @ApiProperty({ type: BusinessSummaryView, nullable: true })
  business!: BusinessSummaryView | null;
  @ApiPropertyOptional({
    type: AdminSessionViewDto,
    description: 'Admin and super_admin accounts only.',
  })
  admin?: AdminSessionViewDto;
}

export class AuthResultView extends AccountViewDto {
  @ApiProperty({ type: TokenPairView }) tokens!: TokenPairView;
}

export class SigninResultView extends AuthResultView {
  @ApiPropertyOptional({
    enum: [true],
    description: 'Admin portal: the password was right; now the second factor.',
  })
  totpRequired?: true;
  @ApiPropertyOptional({ description: 'Admin portal: no authenticator yet.' })
  enrolmentRequired?: boolean;
  @ApiPropertyOptional({
    description:
      'Admin portal: 5 minutes, for /auth/admin/totp or /admin/me/totp/*.',
  })
  challengeToken?: string;
}

export class TotpEnrolmentView {
  @ApiProperty() otpauthUri!: string;
  @ApiProperty({ description: 'PNG data URL of the otpauth URI.' })
  qrDataUrl!: string;
  @ApiProperty({ description: 'Base32, for typing in by hand.' })
  secret!: string;
}

export class TotpConfirmView {
  @ApiProperty({ type: [String], description: 'Shown once.' })
  recoveryCodes!: string[];
  @ApiProperty({
    type: AuthResultView,
    nullable: true,
    description: 'With a challenge token (first enrolment): the new session.',
  })
  auth!: AuthResultView | null;
}
