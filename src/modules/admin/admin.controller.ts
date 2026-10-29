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
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
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
import {
  AdminAny,
  RequirePermission,
} from '../../common/decorators/require-permission.decorator';
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
import { AdminWebSession } from '../auth/web/admin-web-session';
import { TotpConfirmView, TotpEnrolmentView } from '../auth/dto/auth.response';
import {
  ApiEnvelopeOk,
  ApiPagedOk,
  FlagView,
} from '../../common/swagger/api-envelope';
import {
  AdminBusinessDetailView,
  AdminBusinessListItemView,
  AdminUserDetailView,
  AdminUserView,
  BusinessDetailView,
} from './dto/admin.response';

const uuid = new ParseUUIDPipe();

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@RequirePermission('approvePartners')
@Controller('admin/businesses')
export class AdminBusinessesController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  @ApiOperation({ summary: 'Businesses → { items, total, page, pageSize }.' })
  @ApiPagedOk(AdminBusinessListItemView)
  list(@Query() q: AdminBusinessQueryDto) {
    return this.admin.listBusinesses(q);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'One business with owner, documents, requirements and history.',
  })
  @ApiEnvelopeOk(AdminBusinessDetailView)
  get(@Param('id', uuid) id: string) {
    return this.admin.getBusiness(id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'pending_approval → approved; emails the partner.' })
  @ApiEnvelopeOk(BusinessDetailView)
  approve(@CurrentUser() me: AuthenticatedUser, @Param('id', uuid) id: string) {
    return this.admin.approve(me, id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'pending_approval → rejected with a reason (+ per-document notes); emails the partner.',
  })
  @ApiEnvelopeOk(BusinessDetailView)
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
  @ApiEnvelopeOk(BusinessDetailView)
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
  @ApiEnvelopeOk(BusinessDetailView)
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
@RequirePermission('manageUsers')
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  @ApiOperation({ summary: 'Accounts → { items, total, page, pageSize }.' })
  @ApiPagedOk(AdminUserView)
  list(@Query() q: AdminUserQueryDto) {
    return this.admin.listUsers(q);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'One account: profile, businesses, last sign-in and live session count.',
  })
  @ApiEnvelopeOk(AdminUserDetailView)
  get(@Param('id', uuid) id: string) {
    return this.admin.getUser(id);
  }

  @Post(':id/sign-out-everywhere')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Revoke every session and outstanding access token of the account.',
  })
  @ApiEnvelopeOk(FlagView)
  signOutEverywhere(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', uuid) id: string,
  ) {
    return this.admin.signOutEverywhere(me, id);
  }

  @Post(':id/disable')
  @HttpCode(200)
  @ApiOperation({ summary: 'Disable an account and sign it out everywhere.' })
  @ApiEnvelopeOk(AdminUserView)
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
  @ApiEnvelopeOk(AdminUserView)
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
@AdminAny()
@UseGuards(AdminTotpEnrolGuard)
@Controller('admin/me/totp')
export class AdminTotpController {
  constructor(
    private readonly totp: AdminTotpService,
    private readonly web: AdminWebSession,
  ) {}

  @Post('enrol')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Start TOTP enrolment: { otpauthUri, qrDataUrl, secret }. Bearer: admin access token or first-time challenge token.',
  })
  @ApiEnvelopeOk(TotpEnrolmentView)
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
  @ApiHeader({
    name: 'X-Client',
    required: false,
    description:
      'admin-web on a first enrolment: the session starts as a console cookie session (see /auth/admin/totp).',
  })
  @ApiEnvelopeOk(TotpConfirmView)
  async confirm(
    @Req() req: TotpEnrolRequest,
    @Body() dto: ConfirmTotpDto,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) res: Response,
  ) {
    const viaConsole =
      req.totpAuth?.kind === 'challenge' && this.web.wantsCookie(req);
    if (viaConsole) this.web.assertFromConsole(req);
    const result = await this.totp.confirm(
      req.user!.id,
      req.totpAuth!,
      dto,
      client,
      viaConsole ? 'admin_web' : 'app',
    );
    if (viaConsole && result.auth) {
      return { ...result, auth: this.web.handOver(res, result.auth) };
    }
    return result;
  }
}
