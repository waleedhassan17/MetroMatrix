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
import { Trim } from '../../../common/validation/transforms';
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
    nullable: true,
    description:
      'A URL from an upload signed for purpose "avatar" (your avatar folder on our Cloudinary), or null to remove.',
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
