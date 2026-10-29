import {
  AdminHealthBannersCreateView,
  AdminHealthBannersRemoveView,
  AdminHealthBannersReorderView,
  AdminHealthBannersUpdateView,
} from './admin-banners.response';
import { ApiEnvelopeOk } from '../../../common/swagger/api-envelope';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminBannersService } from './admin-banners.service';
import {
  HealthBannerDto,
  ReorderHealthBannersDto,
  UpdateHealthBannerDto,
} from './dto/admin-banners.dto';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';

const uuid = new ParseUUIDPipe();

@ApiTags('admin · health')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@RequirePermission('manageContent')
@Controller('admin/health/banners')
export class AdminHealthBannersController {
  constructor(private readonly banners: AdminBannersService) {}

  @Get()
  @ApiOperation({
    summary: 'Every Health home banner (inactive and expired too), in order.',
  })
  @ApiEnvelopeOk(AdminHealthBannersCreateView, { isArray: true })
  list() {
    return this.banners.list();
  }

  @Post()
  @ApiOperation({
    summary:
      '{ imageUrl (own banner upload), title, subtitle?, targetType, targetId? | targetScreen?, city?, startsAt?, endsAt?, sort?, isActive? }. Audited.',
  })
  @ApiEnvelopeOk(AdminHealthBannersCreateView, { status: 201 })
  create(@CurrentUser() me: AuthenticatedUser, @Body() dto: HealthBannerDto) {
    return this.banners.create(me.id, dto);
  }

  @Put('order')
  @ApiOperation({
    summary:
      '{ ids } — the banners in their new order; any left out follow. Audited.',
  })
  @ApiEnvelopeOk(AdminHealthBannersReorderView, { isArray: true })
  reorder(@Body() dto: ReorderHealthBannersDto) {
    return this.banners.reorder(dto.ids);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Edit. A new image must be your own upload; the current one may be re-sent. Audited.',
  })
  @ApiEnvelopeOk(AdminHealthBannersUpdateView)
  update(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateHealthBannerDto,
  ) {
    return this.banners.update(me.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete. Audited.' })
  @ApiEnvelopeOk(AdminHealthBannersRemoveView)
  remove(@Param('id', uuid) id: string) {
    return this.banners.remove(id);
  }
}
