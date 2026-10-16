import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { DiscoveryService } from './discovery.service';
import {
  CityQueryDto,
  DoctorQueryDto,
  HomeQueryDto,
  SlotsQueryDto,
} from './dto/discovery.dto';
import { OptionalAuth } from '../../../common/decorators/optional-auth.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';

const uuid = new ParseUUIDPipe();

/**
 * Finding a doctor. Public (a signed-in caller additionally gets their
 * upcoming appointment on /home). Read-heavy, so a generous per-client limit.
 */
@ApiTags('health · discovery')
@OptionalAuth()
@Throttle({ default: { limit: 600, ttl: 60_000 } })
@Controller('health')
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Get('home')
  @ApiOperation({
    summary:
      '{ specialties (top 12), commonConditions, availableTodayNearby (?city), upcomingAppointment, featuredDoctors }',
  })
  home(@Query() q: HomeQueryDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.discovery.home(q.city, user?.id);
  }

  @Get('specialties')
  @ApiOperation({
    summary: 'All specialties (English + Urdu) with doctorCount (?city).',
  })
  specialties(@Query() q: CityQueryDto) {
    return this.discovery.specialties(q.city);
  }

  @Get('doctors')
  @ApiOperation({
    summary:
      'Doctors: ?q&specialtyId&conditionId&city&area&kind&availableToday&gender&minFee&maxFee&minExperience&minRating&language&lat&lng&sort&page&pageSize',
  })
  list(@Query() q: DoctorQueryDto) {
    return this.discovery.list(q);
  }

  @Get('doctors/:id')
  @ApiOperation({
    summary:
      'Full profile: badges, stats, locations with timings and next slot, review summary. Unlisted → 404 DOCTOR_NOT_LISTED.',
  })
  profile(@Param('id', uuid) id: string) {
    return this.discovery.profile(id);
  }

  @Get('doctors/:id/similar')
  similar(@Param('id', uuid) id: string) {
    return this.discovery.similar(id);
  }

  @Get('doctors/:id/locations/:locationId/slots')
  @ApiOperation({
    summary:
      '?from=YYYY-MM-DD&days=7 (≤ 14) → [{ date, weekdayLabel, isAvailable, slots: [{ startsAt, endsAt, period }] }]',
  })
  slots(
    @Param('id', uuid) id: string,
    @Param('locationId', uuid) locationId: string,
    @Query() q: SlotsQueryDto,
  ) {
    return this.discovery.slots(id, locationId, q.from, q.days ?? 7);
  }
}
