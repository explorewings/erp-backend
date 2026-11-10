import { Body, Controller, Get, Patch, Query, Request, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { MenuAccess, MenuAccessGuard } from '../access/menu-access.guard';
import { ListNotificationsQueryDto, MarkReadDto } from './dto/notifications.dto';
import { NotificationsService } from './notifications.service';

/** /rest/v1/notifications — always scoped to the signed-in user. */
@Controller('notifications')
@UseGuards(JwtGuard, MenuAccessGuard)
@MenuAccess('menu:calendar')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@Query() query: ListNotificationsQueryDto, @Request() req: any) {
    return this.notifications.list(req.user.id, query.page ?? 1);
  }

  @Get('unread-count')
  async unread(@Request() req: any) {
    return { unread: await this.notifications.unreadCount(req.user.id) };
  }

  @Patch('read')
  markRead(@Body() dto: MarkReadDto, @Request() req: any) {
    return this.notifications.markRead(req.user.id, dto.ids);
  }
}
