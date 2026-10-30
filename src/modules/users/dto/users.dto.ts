import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { IsPkPhone } from '../../../common/validation/phone';
import { IsBirthDate } from '../../../common/validation/birth-date';
import { Trim } from '../../../common/validation/transforms';
import { USER_GENDERS, UserGender } from '../../../types';
import {
  DEVICE_PLATFORMS,
  DevicePlatform,
} from '../entities/user-device.entity';

export class UpdateMeDto {
  @ApiPropertyOptional({ example: 'Ayesha Khan', minLength: 2, maxLength: 80 })
  @IsOptional()
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  displayName?: string;

  @ApiPropertyOptional({
    example: '0312 4890176',
    description: 'Stored as +923XXXXXXXXX.',
  })
  @IsOptional()
  @IsPkPhone()
  phone?: string;

  @ApiPropertyOptional({
    // `string | null` can't be inferred: without this Swagger says "object".
    type: String,
    nullable: true,
    maxLength: 500,
    description:
      'A URL from an upload signed for purpose "avatar" (your avatar folder on our Cloudinary), or null to remove.',
  })
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(500)
  avatarUrl?: string | null;
}

/**
 * PATCH /users/me/profile — the customer's Complete Profile, saved in one go.
 * Date of birth, gender, street address and city are required; postal code
 * and photo are optional.
 */
export class CompleteProfileDto {
  @ApiProperty({
    example: '1998-02-14',
    description: 'YYYY-MM-DD; at least 13 years ago.',
  })
  @IsBirthDate()
  dateOfBirth!: string;

  @ApiProperty({ enum: USER_GENDERS, example: 'female' })
  @IsIn([...USER_GENDERS])
  gender!: UserGender;

  @ApiProperty({
    example: '7 Canal View, Johar Town',
    minLength: 5,
    maxLength: 255,
  })
  @Trim()
  @IsString()
  @MinLength(5)
  @MaxLength(255)
  streetAddress!: string;

  @ApiProperty({ example: 'Lahore', maxLength: 60 })
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  city!: string;

  @ApiPropertyOptional({ example: '54000', description: '5 digits.' })
  @IsOptional()
  @Trim()
  @Matches(/^\d{5}$/, { message: 'Postal codes are 5 digits' })
  postalCode?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 500,
    description:
      'A URL from an upload signed for purpose "avatar", as for PATCH /users/me.',
  })
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(500)
  avatarUrl?: string | null;
}

export const EXPO_PUSH_TOKEN =
  /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$/;

export class RegisterDeviceDto {
  @ApiProperty({ example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]' })
  @IsString()
  @Matches(EXPO_PUSH_TOKEN, {
    message: 'expoPushToken must be an Expo push token',
  })
  expoPushToken!: string;

  @ApiProperty({ enum: DEVICE_PLATFORMS, example: 'android' })
  @IsIn([...DEVICE_PLATFORMS])
  platform!: DevicePlatform;
}
