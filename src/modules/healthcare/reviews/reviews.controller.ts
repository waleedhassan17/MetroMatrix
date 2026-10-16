import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ReviewsService } from './reviews.service';
import {
  AdminReviewQueryDto,
  CreateReviewDto,
  HideReviewDto,
  ReplyDto,
  ReviewQueryDto,
} from './dto/review.dto';
import { HealthDoctor, HealthPatient } from '../common/health-roles.decorator';
import {
  CurrentDoctor,
  CurrentDoctorRef,
} from '../common/current-doctor.decorator';
import { OptionalAuth } from '../../../common/decorators/optional-auth.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';

@ApiTags('health · discovery')
@OptionalAuth()
@Throttle({ default: { limit: 600, ttl: 60_000 } })
@Controller('health/doctors')
export class PublicReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get(':id/reviews')
  @ApiOperation({
    summary:
      '?sort=recent|highest|lowest&kind=clinic|video&page — visible, verified-visit reviews.',
  })
  list(@Param('id', ParseUUIDPipe) id: string, @Query() q: ReviewQueryDto) {
    return this.reviews.publicList(id, q);
  }
}

@ApiTags('health · patient')
@HealthPatient()
@Controller('health/appointments')
export class PatientReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post(':code/review')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary:
      '{ overall, diagnosis?, staff?, environment? (clinic), wouldRecommend, tags?, comment?, anonymous? } — once, after completion, within 30 days.',
  })
  create(
    @CurrentUser() me: AuthenticatedUser,
    @Param('code') code: string,
    @Body() dto: CreateReviewDto,
  ) {
    return this.reviews.create(me.id, code, dto);
  }
}

@ApiTags('health · doctor')
@HealthDoctor()
@Controller('health/doctor/reviews')
export class DoctorReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  @ApiOperation({ summary: 'All your reviews, hidden ones flagged.' })
  list(@CurrentDoctor() d: CurrentDoctorRef, @Query() q: ReviewQueryDto) {
    return this.reviews.doctorList(d.id, q);
  }

  @Post(':id/reply')
  @HttpCode(200)
  @ApiOperation({ summary: '{ text } — public; replaces an earlier reply.' })
  reply(
    @CurrentDoctor() d: CurrentDoctorRef,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplyDto,
  ) {
    return this.reviews.reply(d.id, id, dto.text);
  }
}

@ApiTags('admin · health')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@Controller('admin/health/reviews')
export class AdminReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  @ApiOperation({ summary: '?doctorId&hidden=true|false&page' })
  list(@Query() q: AdminReviewQueryDto) {
    return this.reviews.adminList(q);
  }

  @Post(':id/hide')
  @HttpCode(200)
  @ApiOperation({
    summary: '{ reason } — off public lists and the rating. Audited.',
  })
  hide(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: HideReviewDto,
  ) {
    return this.reviews.setHidden(me.id, id, true, dto.reason);
  }

  @Post(':id/unhide')
  @HttpCode(200)
  unhide(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reviews.setHidden(me.id, id, false, null);
  }
}
