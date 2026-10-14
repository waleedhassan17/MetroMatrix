import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminService } from './admin.service';
import {
  AdminBusinessQueryDto,
  AdminUserQueryDto,
  DisableUserDto,
  ReasonDto,
  RejectBusinessDto,
} from './dto/admin.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { PublicRoute } from '../../common/decorators/public.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import {
  Client,
  ClientInfo,
} from '../../common/decorators/client-info.decorator';
import {
  AdminTotpEnrolGuard,
  TotpEnrolRequest,
} from '../auth/guards/admin-totp-enrol.guard';
import { ConfirmTotpDto } from '../auth/dto/totp.dto';
import { AdminTotpService } from './admin-totp.service';

const uuid = new ParseUUIDPipe();

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@Controller('admin/businesses')
export class AdminBusinessesController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  @ApiOperation({ summary: 'Businesses → { items, total, page, pageSize }.' })
  list(@Query() q: AdminBusinessQueryDto) {
    return this.admin.listBusinesses(q);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'One business with owner, documents, requirements and history.',
  })
  get(@Param('id', uuid) id: string) {
    return this.admin.getBusiness(id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'pending_approval → approved; emails the partner.' })
  approve(@CurrentUser() me: AuthenticatedUser, @Param('id', uuid) id: string) {
    return this.admin.approve(me, id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'pending_approval → rejected with a reason (+ per-document notes); emails the partner.',
  })
  reject(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body() dto: RejectBusinessDto,
  ) {
    return this.admin.reject(me, id, dto);
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @ApiOperation({ summary: 'approved → suspended; emails the partner.' })
  suspend(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.admin.suspend(me, id, dto.reason);
  }

  @Post(':id/reinstate')
  @HttpCode(200)
  @ApiOperation({ summary: 'suspended → approved; emails the partner.' })
  reinstate(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.admin.reinstate(me, id, dto.reason);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  @ApiOperation({ summary: 'Accounts → { items, total, page, pageSize }.' })
  list(@Query() q: AdminUserQueryDto) {
    return this.admin.listUsers(q);
  }

  @Post(':id/disable')
  @HttpCode(200)
  @ApiOperation({ summary: 'Disable an account and sign it out everywhere.' })
  disable(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body() dto: DisableUserDto,
  ) {
    return this.admin.disableUser(me, id, dto.reason);
  }

  @Post(':id/enable')
  @HttpCode(200)
  @ApiOperation({ summary: 'Re-enable a disabled account.' })
  enable(@CurrentUser() me: AuthenticatedUser, @Param('id', uuid) id: string) {
    return this.admin.enableUser(me, id);
  }
}

/**
 * Public as far as the global JWT guard is concerned: AdminTotpEnrolGuard
 * authenticates (admin access token, or an un-enrolled admin's challenge).
 */
@ApiTags('admin')
@ApiBearerAuth()
@PublicRoute()
@UseGuards(AdminTotpEnrolGuard)
@Controller('admin/me/totp')
export class AdminTotpController {
  constructor(private readonly totp: AdminTotpService) {}

  @Post('enrol')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Start TOTP enrolment: { otpauthUri, qrDataUrl, secret }. Bearer: admin access token or first-time challenge token.',
  })
  enrol(@CurrentUser() me: AuthenticatedUser) {
    return this.totp.enrol(me.id);
  }

  @Post('confirm')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Confirm with a code → { recoveryCodes (shown once), auth }. With a challenge token, `auth` is the AuthResult.',
  })
  confirm(
    @Req() req: TotpEnrolRequest,
    @Body() dto: ConfirmTotpDto,
    @Client() client: ClientInfo,
  ) {
    return this.totp.confirm(req.user!.id, req.totpAuth!, dto, client);
  }
}
