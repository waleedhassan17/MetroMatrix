import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseArrayPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminReferenceService } from './admin-reference.service';
import { AdminAppointmentsService } from './admin-appointments.service';
import {
  AdminAppointmentQueryDto,
  AdminConditionQueryDto,
  AdminReasonDto,
  ConditionDto,
  ConditionSpecialtyDto,
  SpecialtyDto,
  UpdateConditionDto,
  UpdateSpecialtyDto,
} from './dto/admin-health.dto';
import { Roles } from '../../../common/decorators/roles.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';

@ApiTags('admin · health')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@Controller('admin/health')
export class AdminReferenceController {
  constructor(private readonly reference: AdminReferenceService) {}

  @Get('specialties')
  @ApiOperation({
    summary: 'All specialties (inactive too) with doctor counts.',
  })
  specialties() {
    return this.reference.specialties();
  }

  @Post('specialties')
  createSpecialty(@Body() dto: SpecialtyDto) {
    return this.reference.createSpecialty(dto);
  }

  @Patch('specialties/:id')
  @ApiOperation({
    summary:
      'Edit or deactivate (isActive: false). Refreshes affected doctors’ search. Audited.',
  })
  updateSpecialty(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSpecialtyDto,
  ) {
    return this.reference.updateSpecialty(id, dto);
  }

  @Get('conditions')
  @ApiOperation({ summary: '?q&page — with their ranked specialties.' })
  conditions(@Query() q: AdminConditionQueryDto) {
    return this.reference.conditions(q);
  }

  @Post('conditions')
  createCondition(@Body() dto: ConditionDto) {
    return this.reference.createCondition(dto);
  }

  @Patch('conditions/:id')
  updateCondition(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateConditionDto,
  ) {
    return this.reference.updateCondition(id, dto);
  }

  @Put('conditions/:id/specialties')
  @ApiBody({ type: [ConditionSpecialtyDto] })
  @ApiOperation({
    summary:
      '[{ specialtyId, rank }] — replaces the mapping; rank 1 is the first choice.',
  })
  mapCondition(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ParseArrayPipe({ items: ConditionSpecialtyDto, whitelist: true }))
    list: ConditionSpecialtyDto[],
  ) {
    return this.reference.mapCondition(id, list);
  }
}

@ApiTags('admin · health')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@Controller('admin/health')
export class AdminAppointmentsController {
  constructor(private readonly appointments: AdminAppointmentsService) {}

  @Get('overview')
  @ApiOperation({
    summary:
      'Doctors (listed, awaiting PMDC), today by status, last 7 days, reviews, symptom checks, top specialties.',
  })
  overview() {
    return this.appointments.overview();
  }

  @Get('appointments')
  @ApiOperation({ summary: '?code&doctorId&patientUserId&status&date&page' })
  list(@Query() q: AdminAppointmentQueryDto) {
    return this.appointments.list(q);
  }

  @Get('appointments/:code')
  @ApiOperation({
    summary:
      'Booking facts, payment trail and timeline — never notes, prescriptions or records. Audited.',
  })
  detail(@Param('code') code: string) {
    return this.appointments.detail(code);
  }

  @Post('appointments/:code/cancel')
  @HttpCode(200)
  @ApiOperation({
    summary:
      '{ reason } — on a patient’s or doctor’s behalf; both are told. Audited.',
  })
  cancel(
    @CurrentUser() me: AuthenticatedUser,
    @Param('code') code: string,
    @Body() dto: AdminReasonDto,
  ) {
    return this.appointments.cancel(me.id, code, dto.reason);
  }
}
