import { Body, Controller, Get, Patch, Query, Request, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { ListNotificationsQueryDto, MarkReadDto } from './dto/notifications.dto';
import { NotificationsService } from './notifications.service';

/**
 * /notifications — always scoped to the signed-in user.
 * Deliberately NOT gated by MenuAccess: notifications are a cross-cutting
 * surface, so every signed-in user keeps their bell regardless of which
 * menus they were granted.
 */
@Controller('notifications')
@UseGuards(JwtGuard)
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
