import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { NormalizeEmail } from '../../../common/validation/transforms';
import { SIGNIN_PORTALS, SigninPortal } from '../signin-portal';

export class SigninDto {
  @ApiProperty({ example: 'ayesha@example.com' })
  @NormalizeEmail()
  @IsEmail({}, { message: 'Enter a valid email address' })
  email!: string;

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
