import {
  AdminHealthClearUnlistView,
  AdminHealthDoctorsView,
  AdminHealthUnlistView,
  AdminHealthUnverifyView,
  AdminHealthVerifyView,
} from './admin-health.response';
import {
  ApiEnvelopeOk,
  ApiPagedOk,
} from '../../../common/swagger/api-envelope';
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
import { AdminHealthService } from './admin-health.service';
import {
  AdminDoctorQueryDto,
  AdminNoteDto,
  AdminReasonDto,
} from './dto/admin-health.dto';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';

const uuid = new ParseUUIDPipe();

/** MetroMatrix staff tools for Healthcare. Every write is audited. */
@ApiTags('admin · health')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@RequirePermission('manageHealthcare')
@Controller('admin/health')
export class AdminHealthController {
  constructor(private readonly admin: AdminHealthService) {}

  @Get('doctors')
  @ApiOperation({
    summary:
      'Doctors incl. pending businesses: ?pmdc=unverified (the verification queue)&businessId&q&page.',
  })
  @ApiPagedOk(AdminHealthDoctorsView)
  doctors(@Query() q: AdminDoctorQueryDto) {
    return this.admin.doctors(q);
  }

  @Post('doctors/:id/pmdc-verify')
  @HttpCode(200)
  @ApiOperation({
    summary: '{ note? } — required before the doctor business can be approved.',
  })
  @ApiEnvelopeOk(AdminHealthVerifyView)
  verify(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body() dto: AdminNoteDto,
  ) {
    return this.admin.pmdcVerify(me.id, id, dto.note ?? null);
  }

  @Post('doctors/:id/pmdc-unverify')
  @HttpCode(200)
  @ApiEnvelopeOk(AdminHealthUnverifyView)
  unverify(@Param('id', uuid) id: string, @Body() dto: AdminReasonDto) {
    return this.admin.pmdcUnverify(id, dto.reason);
  }

  @Post('doctors/:id/unlist')
  @HttpCode(200)
  @ApiOperation({
    summary:
      '{ reason } — off the directory; the doctor can’t republish until cleared.',
  })
  @ApiEnvelopeOk(AdminHealthUnlistView)
  unlist(@Param('id', uuid) id: string, @Body() dto: AdminReasonDto) {
    return this.admin.unlist(id, dto.reason);
  }

  @Post('doctors/:id/clear-unlist')
  @HttpCode(200)
  @ApiEnvelopeOk(AdminHealthClearUnlistView)
  clearUnlist(@Param('id', uuid) id: string) {
    return this.admin.clearUnlist(id);
  }
}
