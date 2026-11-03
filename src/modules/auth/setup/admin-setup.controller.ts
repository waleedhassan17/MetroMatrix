import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PublicRoute } from '../../../common/decorators/public.decorator';
import { SkipIdempotency } from '../../../common/decorators/require-idempotency-key.decorator';
import { ApiEnvelopeOk } from '../../../common/swagger/api-envelope';
import { SigninResultView } from '../dto/auth.response';
import { AdminSetupDto, AdminSetupStatusView } from './admin-setup.dto';
import { AdminSetupService } from './admin-setup.service';

/** First run of the web console: register the first super admin. */
@ApiTags('auth: admin setup')
@Controller('auth/admin/setup')
export class AdminSetupController {
  constructor(private readonly setup: AdminSetupService) {}

  @Get()
  @PublicRoute()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Is the console set up? { setupRequired, setupCodeConfigured } — the landing page shows registration or sign-in.',
  })
  @ApiEnvelopeOk(AdminSetupStatusView)
  status() {
    return this.setup.status();
  }

  @Post()
  @PublicRoute()
  @HttpCode(200)
  @SkipIdempotency()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Register the first super admin with ADMIN_SETUP_CODE → { totpRequired, enrolmentRequired: true, challengeToken }; then enrol at /admin/me/totp/*. 409 SETUP_COMPLETE once one exists.',
  })
  @ApiEnvelopeOk(SigninResultView)
  register(@Body() dto: AdminSetupDto) {
    return this.setup.setup(dto);
  }
}
