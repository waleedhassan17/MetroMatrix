import { Body, Controller, Get, Header, Patch } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { IsObject } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RequireStepUp } from '../../common/decorators/require-step-up.decorator';
import { PublicRoute } from '../../common/decorators/public.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { ApiEnvelopeOk } from '../../common/swagger/api-envelope';
import { StepUpDto } from '../admin/admins/admin-admins.dto';
import { PlatformSettingsService } from './platform-settings.service';
import { SETTING_KEYS } from './settings-schema';

export class UpdateSettingsDto extends StepUpDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { 'maintenance.enabled': true },
    description: `Keys to change, from: ${SETTING_KEYS.join(', ')}.`,
  })
  @IsObject()
  values!: Record<string, unknown>;
}

class SettingChangeBy {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ nullable: true, type: String }) displayName!: string | null;
}

export class SettingChangeView {
  @ApiProperty({ type: SettingChangeBy, nullable: true })
  by!: SettingChangeBy | null;
  @ApiProperty({ format: 'date-time' }) at!: Date;
}

export class SettingSpecView {
  @ApiProperty({ enum: SETTING_KEYS }) key!: string;
  @ApiProperty({ enum: ['boolean', 'string', 'email'] }) type!: string;
  @ApiProperty({ oneOf: [{ type: 'boolean' }, { type: 'string' }] })
  default!: boolean | string;
  @ApiProperty() group!: string;
  @ApiProperty() label!: string;
  @ApiProperty() description!: string;
  @ApiPropertyOptional() maxLength?: number;
  @ApiPropertyOptional() allowEmpty?: boolean;
}

export class AdminSettingsView {
  @ApiProperty({
    type: 'object',
    additionalProperties: { oneOf: [{ type: 'boolean' }, { type: 'string' }] },
  })
  values!: Record<string, boolean | string>;

  @ApiProperty({ type: [SettingSpecView] }) schema!: SettingSpecView[];

  @ApiProperty({
    type: 'object',
    additionalProperties: { $ref: '#/components/schemas/SettingChangeView' },
    description: 'Who changed each setting last (absent: never changed).',
  })
  lastChanged!: Record<string, SettingChangeView>;
}

class ServiceSwitch {
  @ApiProperty() enabled!: boolean;
}

class ConfigServices {
  @ApiProperty({ type: ServiceSwitch }) shopping!: ServiceSwitch;
  @ApiProperty({ type: ServiceSwitch }) healthcare!: ServiceSwitch;
  @ApiProperty({ type: ServiceSwitch }) food!: ServiceSwitch;
  @ApiProperty({ type: ServiceSwitch }) kitchen!: ServiceSwitch;
}

class ConfigSignups {
  @ApiProperty() customer!: boolean;
  @ApiProperty() partner!: boolean;
}

class ConfigMaintenance {
  @ApiProperty() enabled!: boolean;
  @ApiProperty() message!: string;
}

class ConfigSupport {
  @ApiProperty({ nullable: true, type: String }) email!: string | null;
}

export class PublicConfigView {
  @ApiProperty({ type: ConfigSignups }) signupsEnabled!: ConfigSignups;
  @ApiProperty({ type: ConfigServices }) services!: ConfigServices;
  @ApiProperty({ type: ServiceSwitch }) ai!: ServiceSwitch;
  @ApiProperty({ type: ConfigMaintenance }) maintenance!: ConfigMaintenance;
  @ApiProperty({ type: ConfigSupport }) support!: ConfigSupport;
}

/** Feature flags and the kill switch. Writes need step-up. */
@ApiTags('admin: settings')
@ApiExtraModels(SettingChangeView)
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@RequirePermission('manageSettings')
@Controller('admin/settings')
export class AdminSettingsController {
  constructor(private readonly settings: PlatformSettingsService) {}

  @Get()
  @ApiOperation({
    summary: 'Every setting: values, schema, and who changed each last.',
  })
  @ApiEnvelopeOk(AdminSettingsView, { description: 'Settings' })
  get() {
    return this.settings.detail();
  }

  @Patch()
  @RequireStepUp()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary:
      '{ values: { key: value }, totpCode } — validated against the schema; one audit row. Step-up.',
  })
  @ApiEnvelopeOk(AdminSettingsView, {
    description: 'Settings after the change',
  })
  update(@CurrentUser() me: AuthenticatedUser, @Body() dto: UpdateSettingsDto) {
    return this.settings.update(me.id, dto.values);
  }
}

/** What the apps read at boot. Public, cached by clients for a minute. */
@ApiTags('config')
@Controller('config')
export class PublicConfigController {
  constructor(private readonly settings: PlatformSettingsService) {}

  @Get()
  @PublicRoute()
  @SkipThrottle()
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({
    summary:
      'Sign-ups, services, AI, maintenance and support email, as the server enforces them.',
  })
  @ApiEnvelopeOk(PublicConfigView, { description: 'Platform config' })
  get() {
    return this.settings.publicConfig();
  }
}
