import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ReferenceService } from './reference.service';
import { ConditionQueryDto, SuggestQueryDto } from './dto/reference.dto';
import { OptionalAuth } from '../../../common/decorators/optional-auth.decorator';
import { SearchSuggestService } from './search-suggest.service';

@ApiTags('health · discovery')
@OptionalAuth()
@Throttle({ default: { limit: 600, ttl: 60_000 } })
@Controller('health')
export class ReferenceController {
  constructor(
    private readonly reference: ReferenceService,
    private readonly suggestService: SearchSuggestService,
  ) {}

  @Get('conditions')
  @ApiOperation({
    summary:
      'Conditions: ?q (name, Urdu or alias, typo-tolerant) &common=true for home chips.',
  })
  conditions(@Query() q: ConditionQueryDto) {
    return this.reference.conditions(q);
  }

  @Get('search/suggest')
  @ApiOperation({
    summary:
      '?q → { doctors (5), specialties (3), conditions (3) } — English, Urdu, aliases, typos.',
  })
  suggest(@Query() q: SuggestQueryDto) {
    return this.suggestService.suggest(q.q);
  }
}
