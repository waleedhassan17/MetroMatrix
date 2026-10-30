import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IsStrongPassword } from '../../../common/validation/password';

export class ResetPasswordDto {
  @ApiProperty({
    description: 'Single-use token returned by /auth/verify-otp.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  resetToken!: string;

  @ApiProperty({ example: 'NewSecret123', minLength: 8 })
  @IsStrongPassword()
  password!: string;
}

export class ChangePasswordDto {
  @ApiPropertyOptional({
    description: 'Required when the account has a password.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  currentPassword?: string;

  @ApiProperty({ example: 'NewSecret123', minLength: 8 })
  @IsStrongPassword()
  newPassword!: string;

  @ApiPropertyOptional({
    description:
      'A fresh Google ID token — required for a Google-only account (no password) setting its first one.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  idToken?: string;
}

export class DeleteAccountDto {
  @ApiPropertyOptional({ description: 'The account password.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  password?: string;

  @ApiPropertyOptional({
    description:
      'A fresh Google ID token — for Google-only accounts, which have no password.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  idToken?: string;
}
