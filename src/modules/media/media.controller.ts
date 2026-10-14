import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsIn } from 'class-validator';
import { MediaService } from './media.service';
import { UPLOAD_PURPOSE_NAMES, UploadPurpose } from './asset-url';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';

export class SignUploadDto {
  @ApiProperty({ enum: UPLOAD_PURPOSE_NAMES, example: 'business_document' })
  @IsIn(UPLOAD_PURPOSE_NAMES)
  purpose!: UploadPurpose;
}

@ApiTags('media')
@ApiBearerAuth()
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('sign-upload')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Signed params for ONE direct upload to Cloudinary, confined to metromatrix/{env}/{userId}/{purpose}.',
  })
  sign(@CurrentUser() user: AuthenticatedUser, @Body() dto: SignUploadDto) {
    return this.media.signUpload(user.id, dto.purpose);
  }
}
