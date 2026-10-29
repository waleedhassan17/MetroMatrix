import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination';
import { Trim } from '../../../common/validation/transforms';
import {
  ADMIN_PERMISSION_KEYS,
  AdminPermission,
} from '../../../types/admin-permissions';

/** `totpCode` on every step-up body (StepUpGuard reads it). */
export class StepUpDto {
  @ApiPropertyOptional({
    example: '123456',
    description:
      'A fresh code from your authenticator. Required: without it the API answers 403 STEP_UP_REQUIRED.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  totpCode?: string;
}

export class AdminListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['admin', 'super_admin'] })
  @IsOptional()
  @IsIn(['admin', 'super_admin'])
  role?: 'admin' | 'super_admin';

  @ApiPropertyOptional({ enum: ['active', 'disabled'] })
  @IsOptional()
  @IsIn(['active', 'disabled'])
  status?: 'active' | 'disabled';

  @ApiPropertyOptional({ description: 'Matches email or name.' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  q?: string;
}

const PERMISSIONS_DOC = {
  enum: ADMIN_PERMISSION_KEYS,
  isArray: true,
  description:
    'Grants for the admin. Admin management is never grantable; a super admin holds everything implicitly.',
};

export class CreateAdminDto extends StepUpDto {
  @ApiProperty({ example: 'reviewer@metromatrix.pk' })
  @Trim()
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'Ayesha Khan', minLength: 2, maxLength: 80 })
  @Trim()
  @IsString()
  @Length(2, 80)
  displayName!: string;

  @ApiProperty(PERMISSIONS_DOC)
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(ADMIN_PERMISSION_KEYS.length)
  @IsIn([...ADMIN_PERMISSION_KEYS], { each: true })
  permissions!: AdminPermission[];
}

export class UpdateAdminPermissionsDto extends StepUpDto {
  @ApiProperty(PERMISSIONS_DOC)
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(ADMIN_PERMISSION_KEYS.length)
  @IsIn([...ADMIN_PERMISSION_KEYS], { each: true })
  permissions!: AdminPermission[];
}

export class DisableAdminDto extends StepUpDto {
  @ApiPropertyOptional({ example: 'Left the team' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

// ── responses ──

export class AdminView {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ nullable: true, type: String }) displayName!: string | null;
  @ApiProperty({ enum: ['admin', 'super_admin'] }) role!: string;
  @ApiProperty({ enum: ['active', 'disabled'] }) status!: string;
  @ApiProperty() isSuperAdmin!: boolean;
  @ApiProperty({
    enum: ADMIN_PERMISSION_KEYS,
    isArray: true,
    description: 'Effective: a super admin lists every key.',
  })
  permissions!: string[];
  @ApiProperty() totpEnabled!: boolean;
  @ApiProperty() mustChangePassword!: boolean;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  lastLoginAt!: Date | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
}

export class AdminWithPasswordView {
  @ApiProperty({ type: AdminView }) admin!: AdminView;

  @ApiProperty({
    example: 'k7Rm4xPq2NvhT9ab',
    description:
      'Shown once and never stored in clear. The admin must change it at first sign-in.',
  })
  temporaryPassword!: string;
}
