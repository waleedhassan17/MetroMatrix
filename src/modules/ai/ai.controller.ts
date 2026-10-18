import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { VoiceService } from './voice/voice.service';
import { VoiceCommandDto } from './voice/dto/voice.dto';
import { AiQuotaService } from './ai-quota.service';
import { AiSettings } from './ai-settings';
import { VoiceContexts } from './voice/voice-contexts';

@ApiTags('ai')
@ApiBearerAuth()
@Roles('partner', 'customer')
@Controller('ai')
export class AiController {
  constructor(
    private readonly voice: VoiceService,
    private readonly quota: AiQuotaService,
    private readonly settings: AiSettings,
    private readonly contexts: VoiceContexts,
    private readonly dataSource: DataSource,
  ) {}

  @Post('voice')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'A spoken (audioUrl) or typed (text) command → { transcript, intent, proposedAction, needsConfirmation: true }. Nothing is executed: the app calls proposedAction after the person confirms. 422 VOICE_UNCLEAR, 400 VOICE_TOO_LONG, 429 AI_QUOTA_REACHED, 503 AI_UNAVAILABLE (details.manual).',
  })
  command(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: VoiceCommandDto,
  ) {
    return this.voice.command(user, dto);
  }

  @Get('usage')
  @ApiOperation({
    summary:
      "This month's smart actions and voice minutes (vendors: the business's plan; customers: 60 actions), which switches are on, and when it resets.",
  })
  async usage(@CurrentUser() user: AuthenticatedUser) {
    const [row] =
      user.role === 'partner'
        ? await this.dataSource.query(
            `SELECT id FROM businesses WHERE owner_user_id = $1 AND status = 'approved' AND service_type = 'food'`,
            [user.id],
          )
        : [];
    const summary = await this.quota.summary({
      businessId: row?.id ?? null,
      userId: user.id,
    });
    return {
      ...summary,
      enabled: this.settings.enabled,
      voiceContexts: this.contexts.list(),
    };
  }
}
