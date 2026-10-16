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
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';

const uuid = new ParseUUIDPipe();

@ApiTags('admin · health')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@Controller('admin/health/banners')
export class AdminHealthBannersController {
  constructor(private readonly banners: AdminBannersService) {}

  @Get()
  @ApiOperation({
    summary: 'Every Health home banner (inactive and expired too), in order.',
  })
  list() {
    return this.banners.list();
  }

  @Post()
  @ApiOperation({
    summary:
      '{ imageUrl (own banner upload), title, subtitle?, targetType, targetId? | targetScreen?, city?, startsAt?, endsAt?, sort?, isActive? }. Audited.',
  })
  create(@CurrentUser() me: AuthenticatedUser, @Body() dto: HealthBannerDto) {
    return this.banners.create(me.id, dto);
  }

  @Put('order')
  @ApiOperation({
    summary:
      '{ ids } — the banners in their new order; any left out follow. Audited.',
  })
  reorder(@Body() dto: ReorderHealthBannersDto) {
    return this.banners.reorder(dto.ids);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Edit. A new image must be your own upload; the current one may be re-sent. Audited.',
  })
  update(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateHealthBannerDto,
  ) {
    return this.banners.update(me.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete. Audited.' })
  remove(@Param('id', uuid) id: string) {
    return this.banners.remove(id);
  }
}
