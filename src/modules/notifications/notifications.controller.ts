import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { NotificationsService } from './notifications.service';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';

export class NotificationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Only unread ones.' })
  @IsOptional()
  @Transform(({ obj }) => obj.unread === 'true' || obj.unread === true)
  @IsBoolean()
  unread?: boolean;
}

/** Any signed-in role: customers, partners and admins all get notifications. */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Newest first → { items, total, page, pageSize }.' })
  list(@CurrentUser() me: AuthenticatedUser, @Query() q: NotificationQueryDto) {
    return this.notifications.list(me.id, q);
  }

  @Get('unread-count')
  @ApiOperation({ summary: '{ unread } for the bell badge.' })
  unread(@CurrentUser() me: AuthenticatedUser) {
    return this.notifications.unreadCount(me.id);
  }

  @Post('read-all')
  @HttpCode(200)
  readAll(@CurrentUser() me: AuthenticatedUser) {
    return this.notifications.markAllRead(me.id);
  }

  @Post(':id/read')
  @HttpCode(200)
  read(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.notifications.markRead(me.id, id);
  }
}
