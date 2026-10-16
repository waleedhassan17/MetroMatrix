import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RecordsService } from './records.service';
import {
  AttachRecordsDto,
  CreateRecordDto,
  RecordQueryDto,
  UpdateRecordDto,
} from './dto/record.dto';
import { HealthDoctor, HealthPatient } from '../common/health-roles.decorator';
import {
  CurrentDoctor,
  CurrentDoctorRef,
} from '../common/current-doctor.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';

@ApiTags('health · patient')
@HealthPatient()
@Controller('health/records')
export class RecordsController {
  constructor(private readonly records: RecordsService) {}

  @Post()
  @ApiOperation({
    summary:
      '{ title, kind, recordDate?, notes?, familyMemberId?, fileUrl, filePublicId, mime? } — file signed for purpose health_record (private).',
  })
  create(@CurrentUser() me: AuthenticatedUser, @Body() dto: CreateRecordDto) {
    return this.records.create(me.id, dto);
  }

  @Get()
  @ApiOperation({ summary: '?person=self|<familyMemberId>&kind&page' })
  list(@CurrentUser() me: AuthenticatedUser, @Query() q: RecordQueryDto) {
    return this.records.list(me.id, q);
  }

  @Get(':id')
  get(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.records.get(me.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRecordDto,
  ) {
    return this.records.update(me.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Also un-shares it from every visit.' })
  remove(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.records.remove(me.id, id);
  }
}

@ApiTags('health · patient')
@HealthPatient()
@Controller('health/appointments')
export class AppointmentAttachmentsController {
  constructor(private readonly records: RecordsService) {}

  @Get(':code/attachments')
  list(@CurrentUser() me: AuthenticatedUser, @Param('code') code: string) {
    return this.records.attachmentsOf(me.id, code);
  }

  @Post(':code/attachments')
  @ApiOperation({
    summary:
      '{ recordIds } — share records about this appointment’s person with its doctor, until the visit is completed (409 ATTACHMENTS_CLOSED). Max 10.',
  })
  attach(
    @CurrentUser() me: AuthenticatedUser,
    @Param('code') code: string,
    @Body() dto: AttachRecordsDto,
  ) {
    return this.records.attach(me.id, code, dto);
  }

  @Delete(':code/attachments/:recordId')
  @ApiOperation({ summary: 'Stop sharing — the doctor loses access at once.' })
  detach(
    @CurrentUser() me: AuthenticatedUser,
    @Param('code') code: string,
    @Param('recordId', ParseUUIDPipe) recordId: string,
  ) {
    return this.records.detach(me.id, code, recordId);
  }
}

@ApiTags('health · doctor')
@HealthDoctor()
@Controller('health/doctor/appointments')
export class DoctorRecordsController {
  constructor(private readonly records: RecordsService) {}

  @Get(':code/records/:recordId')
  @ApiOperation({
    summary:
      'A record shared with this appointment (else 404) with a 10-minute download link. Audited (phi.read).',
  })
  get(
    @CurrentDoctor() d: CurrentDoctorRef,
    @Param('code') code: string,
    @Param('recordId', ParseUUIDPipe) recordId: string,
  ) {
    return this.records.forDoctor(d.id, d.ownerUserId, code, recordId);
  }
}
