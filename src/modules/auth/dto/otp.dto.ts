import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Matches } from 'class-validator';
import { NormalizeEmail, Trim } from '../../../common/validation/transforms';

export const OTP_PATTERN = /^\d{6}$/;
const OTP_MESSAGE = 'The code must be 6 digits';

export class VerifyEmailDto {
  @ApiProperty({
    example: '123456',
    description: 'The 6-digit code from the email.',
  })
  @Trim()
  @IsString()
  @Matches(OTP_PATTERN, { message: OTP_MESSAGE })
  otp!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'ayesha@example.com' })
  @NormalizeEmail()
  @IsEmail({}, { message: 'Enter a valid email address' })
  email!: string;
}

export class VerifyResetOtpDto {
  @ApiProperty({ example: 'ayesha@example.com' })
  @NormalizeEmail()
  @IsEmail({}, { message: 'Enter a valid email address' })
  email!: string;

  @ApiProperty({ example: '123456' })
  @Trim()
  @IsString()
  @Matches(OTP_PATTERN, { message: OTP_MESSAGE })
  otp!: string;
}
