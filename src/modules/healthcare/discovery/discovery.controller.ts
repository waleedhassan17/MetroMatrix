import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { DiscoveryService } from './discovery.service';
import { OptionalAuth } from '../../../common/decorators/optional-auth.decorator';

const uuid = new ParseUUIDPipe();

@ApiTags('health · discovery')
@OptionalAuth()
@Throttle({ default: { limit: 600, ttl: 60_000 } })
@Controller('health')
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Get('doctors/:id')
  @ApiOperation({
    summary:
      'A listed doctor’s profile; an unlisted doctor → 404 DOCTOR_NOT_LISTED.',
  })
  profile(@Param('id', uuid) id: string) {
    return this.discovery.profile(id);
  }
}
