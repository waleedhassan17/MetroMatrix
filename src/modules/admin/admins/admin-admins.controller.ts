import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RequireStepUp } from '../../../common/decorators/require-step-up.decorator';
import { SkipIdempotency } from '../../../common/decorators/require-idempotency-key.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';
import {
  ApiEnvelopeOk,
  ApiPagedOk,
} from '../../../common/swagger/api-envelope';
import { AdminAdminsService } from './admin-admins.service';
import {
  AdminListQueryDto,
  AdminView,
  AdminWithPasswordView,
  CreateAdminDto,
  DisableAdminDto,
  StepUpDto,
  UpdateAdminPermissionsDto,
} from './admin-admins.dto';

const uuid = new ParseUUIDPipe();
const STEP_UP_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

/**
 * Admin management. Super admin only (not a grantable permission). Every
 * write needs step-up: `totpCode` in the body.
 */
@ApiTags('admin: admins')
@ApiBearerAuth()
@Roles('super_admin')
@Controller('admin/admins')
export class AdminAdminsController {
  constructor(private readonly admins: AdminAdminsService) {}

  @Get()
  @ApiOperation({ summary: 'Admins and super admins, paged.' })
  @ApiPagedOk(AdminView)
  list(@Query() q: AdminListQueryDto) {
    return this.admins.list(q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One admin.' })
  @ApiEnvelopeOk(AdminView)
  get(@Param('id', uuid) id: string) {
    return this.admins.get(id);
  }

  @Post()
  @RequireStepUp()
  @SkipIdempotency()
  @Throttle(STEP_UP_THROTTLE)
  @ApiOperation({
    summary:
      'Create an admin with a temporary password (returned once). Step-up.',
  })
  @ApiEnvelopeOk(AdminWithPasswordView, { status: 201 })
  create(@Body() dto: CreateAdminDto) {
    return this.admins.create(dto);
  }

  @Patch(':id/permissions')
  @RequireStepUp()
  @Throttle(STEP_UP_THROTTLE)
  @ApiOperation({
    summary: 'Replace the grants; signs the admin out everywhere. Step-up.',
  })
  @ApiEnvelopeOk(AdminView)
  permissions(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateAdminPermissionsDto,
  ) {
    return this.admins.updatePermissions(me, id, dto.permissions);
  }

  @Post(':id/disable')
  @HttpCode(200)
  @RequireStepUp()
  @Throttle(STEP_UP_THROTTLE)
  @ApiOperation({
    summary:
      'Disable and sign out everywhere. Never the last super admin. Step-up.',
  })
  @ApiEnvelopeOk(AdminView)
  disable(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body() dto: DisableAdminDto,
  ) {
    return this.admins.disable(me, id, dto.reason);
  }

  @Post(':id/enable')
  @HttpCode(200)
  @RequireStepUp()
  @Throttle(STEP_UP_THROTTLE)
  @ApiOperation({ summary: 'Re-enable a disabled admin. Step-up.' })
  @ApiEnvelopeOk(AdminView)
  enable(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body() _dto: StepUpDto,
  ) {
    return this.admins.enable(me, id);
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  @RequireStepUp()
  @SkipIdempotency()
  @Throttle(STEP_UP_THROTTLE)
  @ApiOperation({
    summary:
      'A new temporary password (returned once); signs out everywhere. Step-up.',
  })
  @ApiEnvelopeOk(AdminWithPasswordView)
  resetPassword(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body() _dto: StepUpDto,
  ) {
    return this.admins.resetPassword(me, id);
  }

  @Post(':id/reset-totp')
  @HttpCode(200)
  @RequireStepUp()
  @Throttle(STEP_UP_THROTTLE)
  @ApiOperation({
    summary:
      'Clear the authenticator and recovery codes; the next sign-in enrols again. Step-up.',
  })
  @ApiEnvelopeOk(AdminView)
  resetTotp(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body() _dto: StepUpDto,
  ) {
    return this.admins.resetTotp(me, id);
  }
}
