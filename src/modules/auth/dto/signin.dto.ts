import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { NormalizeEmail, Trim } from '../../../common/validation/transforms';
import { SIGNIN_PORTALS, SigninPortal } from '../signin-portal';

export class SigninDto {
  @ApiPropertyOptional({
    example: 'ayesha@example.com',
    description: 'Send this or `identifier`.',
  })
  @ValidateIf((o: SigninDto) => o.identifier === undefined)
  @NormalizeEmail()
  @IsEmail({}, { message: 'Enter a valid email address' })
  email?: string;

  /**
   * A username or an email. Riders sign in with the username their vendor
   * gave them (they have no usable email); everyone else may send either.
   */
  @ApiPropertyOptional({
    example: 'karahi-house.imran',
    description:
      'Username or email (riders: the username from their vendor). Send this or `email`.',
  })
  @ValidateIf((o: SigninDto) => o.email === undefined)
  @Trim()
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  identifier?: string;

  @ApiProperty({ example: 'Secret123' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;

  /**
   * The door this request came from. An account that belongs on a different
   * door is refused with WRONG_PORTAL — after the password is checked, before
   * any token is issued.
   */
  @ApiProperty({ enum: SIGNIN_PORTALS, example: 'customer' })
  @IsIn([...SIGNIN_PORTALS])
  portal!: SigninPortal;
}

export class RefreshTokenDto {
  @ApiProperty({ description: 'The refresh token from the last AuthResult.' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  refreshToken!: string;
}
