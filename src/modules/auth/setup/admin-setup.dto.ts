import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';
import { NormalizeEmail, Trim } from '../../../common/validation/transforms';
import { IsStrongPassword } from '../../../common/validation/password';

export class AdminSetupDto {
  @ApiProperty({ description: 'ADMIN_SETUP_CODE, as set on the server.' })
  @IsString()
  @MaxLength(200)
  setupCode!: string;

  @ApiProperty({ example: 'owner@example.com' })
  @NormalizeEmail()
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'Ayesha Khan', minLength: 2, maxLength: 80 })
  @Trim()
  @IsString()
  @Length(2, 80)
  displayName!: string;

  @ApiProperty({
    description:
      '8–72 characters with a lower-case letter, an upper-case letter and a digit.',
  })
  @IsStrongPassword()
  password!: string;
}

export class AdminSetupStatusView {
  @ApiProperty({ description: 'True until the first super admin exists.' })
  setupRequired!: boolean;

  @ApiProperty({
    description:
      'ADMIN_SETUP_CODE is set on the server (registration can run).',
  })
  setupCodeConfigured!: boolean;
}
