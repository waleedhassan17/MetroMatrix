import { Controller, Get, UseGuards } from '@nestjs/common';
import { Roles } from '../../src/common/decorators/roles.decorator';
import { PublicRoute } from '../../src/common/decorators/public.decorator';
import { BusinessApprovedGuard } from '../../src/common/guards/business-approved.guard';
import {
  ApprovedBusiness,
  CurrentBusiness,
} from '../../src/common/decorators/current-business.decorator';

/**
 * TEST-ONLY routes, registered in the e2e TestingModule and never in the app
 * (there are no debug routes in any environment).
 */
@Controller('__test__')
export class ProbeController {
  /** A partner route exactly as Chunk 2+ will write them. */
  @Get('partner-only')
  @Roles('partner')
  @UseGuards(BusinessApprovedGuard)
  partnerOnly(@CurrentBusiness() business: ApprovedBusiness) {
    return { business };
  }

  /** An unexpected failure carrying internals that must never leak. */
  @Get('boom')
  @PublicRoute()
  boom(): never {
    throw new Error(
      'relation "users" does not exist at SELECT password_hash FROM users WHERE id = $1',
    );
  }
}
