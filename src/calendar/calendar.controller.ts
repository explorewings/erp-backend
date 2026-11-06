import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/guards/roles.guard';
import { CalendarService } from './calendar.service';
import { CreateCalendarEventDto } from './dto/create-calendar-event.dto';
import { UpdateCalendarEventDto } from './dto/update-calendar-event.dto';

@Controller('calendar')
@UseGuards(JwtGuard, RolesGuard)
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get()
  list(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('type') type?: string,
    @Query('assigneeId') assigneeId?: string,
    @Query('search') search?: string,
    @Request() req?: any,
  ) {
    return this.calendar.list({ from, to, type, assigneeId, search, viewer: req?.user ?? {} });
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const event = await this.calendar.findOne(id);
    if (!event) throw new NotFoundException(`Calendar event ${id} not found.`);
    return event;
  }

  @Post()
  create(@Body() dto: CreateCalendarEventDto, @Request() req: any) {
    return this.calendar.create(dto, req.user ?? {});
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCalendarEventDto,
    @Request() req: any,
  ) {
    return this.calendar.update(id, dto, req.user ?? {});
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.calendar.remove(id, req.user ?? {});
  }
}
