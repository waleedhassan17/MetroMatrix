import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Trim } from '../../../common/validation/transforms';
import { OTP_PATTERN } from './otp.dto';

export class AdminTotpDto {
  @ApiProperty({
    description: 'From the admin-portal sign-in response (5 minutes).',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  challengeToken!: string;

  @ApiPropertyOptional({
    example: '123456',
    description: 'From the authenticator app.',
  })
  @IsOptional()
  @Trim()
  @Matches(OTP_PATTERN, { message: 'The code must be 6 digits' })
  code?: string;

  @ApiPropertyOptional({
    example: 'abcd-2345',
    description:
      'One of the recovery codes shown at enrolment, instead of `code`.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(32)
  recoveryCode?: string;
}

export class ConfirmTotpDto {
  @ApiProperty({
    example: '123456',
    description: 'A code from the newly added authenticator.',
  })
  @Trim()
  @Matches(OTP_PATTERN, { message: 'The code must be 6 digits' })
  code!: string;

  @ApiPropertyOptional({
    example: '654321',
    description:
      'Rotation only (TOTP already enabled): a code from the CURRENT authenticator, so a stolen session cannot replace it.',
  })
  @IsOptional()
  @Trim()
  @Matches(OTP_PATTERN, { message: 'The code must be 6 digits' })
  currentCode?: string;
}
