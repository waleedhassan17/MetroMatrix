import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class GoogleSigninDto {
  @ApiProperty({
    description:
      'The Google ID token from Google Sign-In on web, Android or iOS (audience = one of GOOGLE_CLIENT_IDS).',
  })
  @IsString()
  @MinLength(10)
  @MaxLength(4096)
  idToken!: string;
}
