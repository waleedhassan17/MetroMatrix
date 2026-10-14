import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsPkPhone } from '../../../common/validation/phone';
import { IsStrongPassword } from '../../../common/validation/password';
import { NormalizeEmail, Trim } from '../../../common/validation/transforms';

export const SIGNUP_ROLES = ['customer', 'partner'] as const;
export type SignupRole = (typeof SIGNUP_ROLES)[number];

export class SignupDto {
  @ApiProperty({ example: 'ayesha@example.com' })
  @NormalizeEmail()
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    example: 'Secret123',
    minLength: 8,
    description:
      'At least 8 characters with a lower-case letter, an upper-case letter and a digit.',
  })
  @IsStrongPassword()
  password!: string;

  @ApiProperty({ example: 'Ayesha Khan', minLength: 2, maxLength: 80 })
  @Trim()
  @IsString()
  @MinLength(2, { message: 'Name must be at least 2 characters' })
  @MaxLength(80, { message: 'Name must be at most 80 characters' })
  displayName!: string;

  @ApiPropertyOptional({
    example: '0312 4890176',
    description:
      'Pakistani mobile. Accepts 03XXXXXXXXX, +923XXXXXXXXX or 923XXXXXXXXX ' +
      '(spaces/dashes allowed); stored as +923XXXXXXXXX.',
  })
  @IsOptional()
  @IsPkPhone()
  phone?: string;

  @ApiProperty({ enum: SIGNUP_ROLES, example: 'customer' })
  @IsIn([...SIGNUP_ROLES])
  role!: SignupRole;
}
