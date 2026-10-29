import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminAny } from '../../common/decorators/require-permission.decorator';
import { RequireStepUp } from '../../common/decorators/require-step-up.decorator';
import { SkipIdempotency } from '../../common/decorators/require-idempotency-key.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { ApiEnvelopeOk } from '../../common/swagger/api-envelope';
import {
  ADMIN_PERMISSION_CATALOGUE,
  ADMIN_PERMISSION_GROUPS,
  ADMIN_PERMISSION_KEYS,
} from '../../types/admin-permissions';
import { StepUpDto } from './admins/admin-admins.dto';
import { AdminMetaService } from './admin-meta.service';

export class PermissionInfoView {
  @ApiProperty({ enum: ADMIN_PERMISSION_KEYS }) key!: string;
  @ApiProperty() group!: string;
  @ApiProperty() label!: string;
  @ApiProperty() description!: string;
}

export class PermissionGroupView {
  @ApiProperty() key!: string;
  @ApiProperty() label!: string;
}

export class AdminMetaView {
  @ApiProperty({ type: [PermissionInfoView] })
  permissions!: PermissionInfoView[];

  @ApiProperty({ type: [PermissionGroupView] })
  permissionGroups!: PermissionGroupView[];

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description: 'Who a broadcast can reach (POST /admin/broadcasts).',
  })
  broadcastAudiences!: Array<Record<string, unknown>>;

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description: 'Every platform setting with its type and limits.',
  })
  settings!: Array<Record<string, unknown>>;
}

export class RecoveryCodesView {
  @ApiProperty({
    type: [String],
    description: 'Shown once. The previous set stops working.',
  })
  recoveryCodes!: string[];
}

/** The console's labels and schemas, from the one place they are defined. */
@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@AdminAny()
@Controller('admin')
export class AdminMetaController {
  constructor(private readonly meta: AdminMetaService) {}

  @Get('meta')
  @ApiOperation({
    summary:
      'Permission catalogue and groups, broadcast audiences and the settings schema.',
  })
  @ApiEnvelopeOk(AdminMetaView)
  get(): AdminMetaView {
    return {
      permissions: [...ADMIN_PERMISSION_CATALOGUE],
      permissionGroups: [...ADMIN_PERMISSION_GROUPS],
      broadcastAudiences: this.meta.broadcastAudiences(),
      settings: this.meta.settingsSchema(),
    };
  }

  @Post('me/recovery-codes')
  @HttpCode(200)
  @RequireStepUp()
  @SkipIdempotency()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Regenerate my recovery codes (returned once). Step-up.',
  })
  @ApiEnvelopeOk(RecoveryCodesView)
  regenerateRecoveryCodes(
    @CurrentUser() me: AuthenticatedUser,
    @Body() _dto: StepUpDto,
  ) {
    return this.meta.regenerateRecoveryCodes(me.id);
  }
}
