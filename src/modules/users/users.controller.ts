import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Patch,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { RegisterDeviceDto, UpdateMeDto } from './dto/users.dto';
import { MediaService } from '../media/media.service';
import { toAuthUser } from '../auth/auth-result';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly media: MediaService,
  ) {}

  @Patch('me')
  @ApiOperation({
    summary: 'Update your name, phone or avatar. Returns the user.',
  })
  async updateMe(
    @CurrentUser() me: AuthenticatedUser,
    @Body() dto: UpdateMeDto,
  ) {
    if (typeof dto.avatarUrl === 'string') {
      this.media.assertOwnedAsset(
        me.id,
        'avatar',
        dto.avatarUrl,
        undefined,
        'avatarUrl',
      );
    }
    const user = await this.users.updateProfile(me.id, dto);
    return toAuthUser(user);
  }

  @Put('me/devices')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Register (or refresh) this install’s Expo push token.',
  })
  registerDevice(
    @CurrentUser() me: AuthenticatedUser,
    @Body() dto: RegisterDeviceDto,
  ) {
    return this.users.registerDevice(me.id, dto.expoPushToken, dto.platform);
  }

  @Delete('me/devices/:token')
  @ApiOperation({
    summary: 'Forget a push token (call on sign-out). Idempotent.',
  })
  removeDevice(
    @CurrentUser() me: AuthenticatedUser,
    @Param('token') token: string,
  ) {
    return this.users.removeDevice(me.id, token);
  }
}
