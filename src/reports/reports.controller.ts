import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { Roles, RolesGuard } from '../auth/guards/roles.guard';
import { MenuAccess, MenuAccessGuard } from '../access/menu-access.guard';
import { CreateReportDto } from './dto/create-report.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import { UpdateReportRemarksDto } from './dto/update-report-remarks.dto';
import { UpdateReportSettingsDto } from './dto/update-report-settings.dto';
import { ReportsService } from './reports.service';

type AuthedRequest = { user: { id: string; role?: string } };
type UploadedReportFile = { buffer: Buffer; originalname: string; mimetype: string; size: number };
const reportRoles = ['staff', 'admin', 'superadmin', 'superuser'];

@Controller('reports')
@UseGuards(JwtGuard, MenuAccessGuard, RolesGuard)
@MenuAccess('menu:reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @Roles(...reportRoles)
  list(
    @Req() req: AuthedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('date') date?: string,
    @Query('userId') userId?: string,
  ) {
    const parsedPage = page === undefined ? 1 : Number(page);
    const parsedLimit = limit === undefined ? 100 : Number(limit);
    if (!Number.isInteger(parsedPage) || parsedPage < 1) {
      throw new BadRequestException('Page must be a positive integer.');
    }
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      throw new BadRequestException('Limit must be between 1 and 100.');
    }
    if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('Date must use the YYYY-MM-DD format.');
    }
    if (userId !== undefined && !/^[0-9a-f-]{36}$/i.test(userId)) {
      throw new BadRequestException('Invalid user id.');
    }
    return this.reports.list(req.user, parsedPage, parsedLimit, date, userId);
  }

  // Declared before ':id' so "settings" is never parsed as a report id.
  @Get('settings')
  @Roles('superadmin', 'superuser')
  getSettings(@Req() req: AuthedRequest) {
    return this.reports.getSettings(req.user);
  }

  @Patch('settings')
  @Roles('superadmin', 'superuser')
  updateSettings(@Req() req: AuthedRequest, @Body() dto: UpdateReportSettingsDto) {
    return this.reports.updateSettings(dto, req.user);
  }

  @Get(':id')
  @Roles(...reportRoles)
  findOne(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.reports.findOne(id, req.user);
  }

  @Post()
  @Roles(...reportRoles)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  create(
    @Req() req: AuthedRequest,
    @Body() dto: CreateReportDto,
    @UploadedFile() file?: UploadedReportFile,
  ) {
    if (dto.attachmentMode === 'file' && !file) throw new BadRequestException('Choose a file to upload.');
    return this.reports.create(dto, file, req.user);
  }

  @Patch(':id')
  @Roles(...reportRoles)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  update(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateReportDto,
    @UploadedFile() file?: UploadedReportFile,
  ) {
    return this.reports.update(id, dto, file, req.user);
  }

  @Patch(':id/remarks')
  @Roles('superadmin', 'superuser')
  updateRemarks(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateReportRemarksDto,
  ) {
    return this.reports.updateRemarks(id, dto.remarks, req.user);
  }

  @Delete(':id')
  @Roles(...reportRoles)
  remove(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.reports.remove(id, req.user);
  }
}
