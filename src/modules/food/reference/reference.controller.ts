import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { OptionalAuth } from '../../../common/decorators/optional-auth.decorator';

@ApiTags('food · discovery')
@OptionalAuth()
@Throttle({ default: { limit: 600, ttl: 60_000 } })
@Controller('food')
export class FoodReferenceController {
  constructor(private readonly dataSource: DataSource) {}

  @Get('cuisines')
  @ApiOperation({
    summary: 'Active cuisines in display order: [{ id, name, slug, icon }].',
  })
  async cuisines() {
    return this.dataSource.query(
      `SELECT id, name, slug, icon FROM cuisines WHERE is_active ORDER BY sort, name`,
    );
  }
}
