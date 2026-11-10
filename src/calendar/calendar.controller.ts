import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { MenuAccess, MenuAccessGuard } from '../access/menu-access.guard';
import { CalendarService } from './calendar.service';
import type { Viewer } from './calendar.policy';
import { CreateCalendarEventDto } from './dto/create-calendar-event.dto';
import { ListCalendarQueryDto, UpdatesQueryDto } from './dto/list-calendar-query.dto';
import { UpdateCalendarEventDto } from './dto/update-calendar-event.dto';

/** /rest/v1/calendar (plan §6). Every rule is enforced in CalendarService via CalendarPolicy. */
@Controller('calendar')
@UseGuards(JwtGuard, MenuAccessGuard, RolesGuard)
@MenuAccess('menu:calendar')
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  private viewer(req: { user?: { id?: string; role?: string; username?: string } }): Viewer {
    return { id: req.user?.id ?? '', role: req.user?.role ?? 'staff', username: req.user?.username };
  }

  @Get()
  list(@Query() query: ListCalendarQueryDto, @Request() req: any) {
    return this.calendar.list(this.viewer(req), query);
  }

  @Get('updates')
  updates(@Query() query: UpdatesQueryDto, @Request() req: any) {
    return this.calendar.feed(this.viewer(req), query.page ?? 1);
  }

  @Get(':id/history')
  history(@Param('id', ParseIntPipe) id: number, @Query('page') page: number, @Request() req: any) {
    return this.calendar.history(this.viewer(req), id, page ?? 1);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.calendar.findOne(this.viewer(req), id);
  }

  @Post()
  create(@Body() dto: CreateCalendarEventDto, @Request() req: any) {
    return this.calendar.create(this.viewer(req), dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCalendarEventDto, @Request() req: any) {
    return this.calendar.update(this.viewer(req), id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.calendar.remove(this.viewer(req), id);
  }
}
