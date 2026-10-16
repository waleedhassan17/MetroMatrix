import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SymptomCheckerService } from './symptom-checker.service';
import { SymptomCheckDto } from './dto/symptom-check.dto';
import { HealthPatient } from '../common/health-roles.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';

@ApiTags('health · patient')
@HealthPatient()
@Controller('health/symptom-checker')
export class SymptomCheckerController {
  constructor(private readonly checker: SymptomCheckerService) {}

  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary:
      '{ text, familyMemberId?, age?, gender? } — emergency answer on red flags ({ emergency, message, numbers: 1122/115 }), else a specialty + urgency + advice + up to 3 areasToDiscuss, always with a disclaimer. 10/hour per user (429 SYMPTOM_CHECK_LIMIT).',
  })
  check(@CurrentUser() me: AuthenticatedUser, @Body() dto: SymptomCheckDto) {
    return this.checker.check(me.id, dto);
  }
}
