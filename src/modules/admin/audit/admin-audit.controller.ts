import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { ApiCursorOk } from '../../../common/swagger/api-envelope';
import { AdminAuditService } from './admin-audit.service';
import { AuditEventView, AuditQueryDto } from './admin-audit.dto';

/** The audit trail. Read-only: there is no update or delete route, and the
 * table itself refuses both (migration AuditTrail). */
@ApiTags('admin: audit')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@RequirePermission('viewAudit')
@Controller('admin/audit')
export class AdminAuditController {
  constructor(private readonly audit: AdminAuditService) {}

  @Get()
  @ApiOperation({
    summary:
      'Newest first, cursor-paged: { items, nextCursor }. Filters: actorUserId, action (or prefix*), targetType, targetId, from, to.',
  })
  @ApiCursorOk(AuditEventView)
  list(@Query() q: AuditQueryDto) {
    return this.audit.list(q);
  }
}
