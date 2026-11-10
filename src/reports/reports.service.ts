import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { AccessService } from '../access/access.service';
import { DRIZZLE, DrizzleDb } from '../database.module';
import { ReportRow, reports, users } from '../schema';
import { StorageService } from '../storage/storage.service';
import { CreateReportDto } from './dto/create-report.dto';
import { UpdateReportDto } from './dto/update-report.dto';

type ReportsUser = { id: string; role?: string };
type UploadedReportFile = { buffer: Buffer; originalname: string; mimetype: string; size: number };
type AttachmentMode = 'none' | 'url' | 'file' | 'keep';

const EDIT_WINDOW_MS = 15 * 60 * 1000;
const allowedFileTypes = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

function isElevated(user: ReportsUser): boolean {
  return user.role === 'superadmin' || user.role === 'superuser';
}

function normalizeReportItems(items: unknown): string[] {
  if (!Array.isArray(items) || items.length < 1 || items.length > 100) {
    throw new BadRequestException('Add between 1 and 100 report points.');
  }
  return items.map((item) => {
    if (typeof item !== 'string') throw new BadRequestException('Report points must be text.');
    const trimmed = item.trim();
    if (!trimmed || trimmed.length > 5000) {
      throw new BadRequestException('Each report point must be between 1 and 5000 characters.');
    }
    return trimmed;
  });
}

function normalizeUrl(value?: string): string {
  if (!value?.trim()) throw new BadRequestException('Enter a URL or choose a file.');
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new BadRequestException('Enter a valid attachment URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BadRequestException('Attachment URLs must use HTTP or HTTPS.');
  }
  return url.toString();
}

function safeFileName(name: string): string {
  const clean = name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-150);
  return clean || 'report-file';
}

@Injectable()
export class ReportsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly storage: StorageService,
    private readonly access: AccessService,
  ) {}

  private async assertCanUseReports(user: ReportsUser): Promise<void> {
    if (!user.id || !['staff', 'admin', 'superadmin', 'superuser'].includes(user.role ?? '')) {
      throw new ForbiddenException('You do not have permission to use Reports.');
    }
    if (isElevated(user)) return;
    if (!(await this.access.hasMenuAccess(user.id, 'menu:reports'))) {
      throw new ForbiddenException('You do not have access to the Reports menu.');
    }
  }

  async list(user: ReportsUser, page = 1, pageSize = 100, reportDate?: string) {
    await this.assertCanUseReports(user);
    const scope = isElevated(user) ? undefined : eq(reports.createdBy, user.id);
    const where = reportDate ? (scope ? and(scope, eq(reports.reportDate, reportDate)) : eq(reports.reportDate, reportDate)) : scope;
    const countRows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(reports)
      .where(where);
    const total = countRows[0]?.count ?? 0;
    const rows = await this.db
      .select({ report: reports, createdByUsername: users.username })
      .from(reports)
      .leftJoin(users, eq(users.id, reports.createdBy))
      .where(where)
      .orderBy(desc(reports.submittedAt), desc(reports.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return {
      items: await Promise.all(rows.map(({ report, createdByUsername }) => this.toResponse(report, createdByUsername))),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      date: reportDate ?? null,
    };
  }

  async create(dto: CreateReportDto, file: UploadedReportFile | undefined, user: ReportsUser) {
    await this.assertCanUseReports(user);
    const reportItems = normalizeReportItems(dto.reports);
    const attachment = await this.buildAttachment(dto.attachmentMode, dto.attachmentUrl, file);
    let created: ReportRow;
    try {
      const [row] = await this.db
        .insert(reports)
        .values({
          reportDate: dto.reportDate,
          reportItems,
          createdBy: user.id,
          ...attachment,
        })
        .returning();
      if (!row) throw new Error('Unable to create report.');
      created = row;
    } catch (error) {
      if (attachment.attachmentKey) await this.storage.delete(this.storage.getBucket(), attachment.attachmentKey);
      throw error;
    }
    const [creator] = await this.db.select({ username: users.username }).from(users).where(eq(users.id, user.id)).limit(1);
    return this.toResponse(created, creator?.username ?? null);
  }

  async update(id: number, dto: UpdateReportDto, file: UploadedReportFile | undefined, user: ReportsUser) {
    await this.assertCanUseReports(user);
    const reportItems = normalizeReportItems(dto.reports);
    let uploadedKey: string | null = null;
    let oldKey: string | null = null;

    try {
      const updated = await this.db.transaction(async (tx) => {
        const [existing] = await tx.select().from(reports).where(eq(reports.id, id)).for('update');
        if (!existing) throw new NotFoundException(`Report ${id} not found.`);
        this.assertCanEdit(existing, user);
        if (dto.attachmentMode === 'keep' && (file || dto.attachmentUrl)) {
          throw new BadRequestException('Remove the unused attachment before keeping the current one.');
        }
        oldKey = existing.attachmentKey;

        const attachment = dto.attachmentMode === 'keep'
          ? {
              attachmentType: existing.attachmentType,
              attachmentUrl: existing.attachmentUrl,
              attachmentKey: existing.attachmentKey,
              attachmentName: existing.attachmentName,
              attachmentContentType: existing.attachmentContentType,
              attachmentSize: existing.attachmentSize,
            }
          : await this.buildAttachment(dto.attachmentMode, dto.attachmentUrl, file);
        uploadedKey = attachment.attachmentKey !== existing.attachmentKey ? attachment.attachmentKey : null;

        const [row] = await tx
          .update(reports)
          .set({
            reportDate: dto.reportDate,
            reportItems,
            updatedAt: new Date(),
            ...attachment,
          })
          .where(eq(reports.id, id))
          .returning();
        if (!row) throw new NotFoundException(`Report ${id} not found.`);
        return row;
      });

      uploadedKey = null;
      const [creator] = updated.createdBy
        ? await this.db.select({ username: users.username }).from(users).where(eq(users.id, updated.createdBy)).limit(1)
        : [];
      const response = await this.toResponse(updated, creator?.username ?? null);
      if (oldKey && oldKey !== updated.attachmentKey) {
        try {
          await this.storage.delete(this.storage.getBucket(), oldKey);
        } catch {
          return { ...response, cleanupWarning: 'The report was saved, but its previous file could not be removed from storage.' };
        }
      }
      return response;
    } catch (error) {
      if (uploadedKey) await this.storage.delete(this.storage.getBucket(), uploadedKey);
      throw error;
    }
  }

  async updateRemarks(id: number, remarks: string | null | undefined, user: ReportsUser) {
    await this.assertCanUseReports(user);
    if (!isElevated(user)) throw new ForbiddenException('Only superadmin or superuser can add remarks.');
    const [updated] = await this.db
      .update(reports)
      .set({ remarks: remarks?.trim() || null, updatedAt: new Date() })
      .where(eq(reports.id, id))
      .returning();
    if (!updated) throw new NotFoundException(`Report ${id} not found.`);
    const [creator] = updated.createdBy
      ? await this.db.select({ username: users.username }).from(users).where(eq(users.id, updated.createdBy)).limit(1)
      : [];
    return this.toResponse(updated, creator?.username ?? null);
  }

  private assertCanEdit(report: ReportRow, user: ReportsUser): void {
    if (isElevated(user)) return;
    if (report.createdBy !== user.id) throw new ForbiddenException('You can only edit your own reports.');
    if (Date.now() - report.submittedAt.getTime() > EDIT_WINDOW_MS) {
      throw new ForbiddenException('Reports can only be edited for 15 minutes after submission.');
    }
  }

  private async buildAttachment(
    mode: AttachmentMode,
    attachmentUrl: string | undefined,
    file: UploadedReportFile | undefined,
  ) {
    if (mode === 'keep') throw new BadRequestException('The attachment cannot be kept on a new report.');
    if (mode === 'none') {
      if (file || attachmentUrl) throw new BadRequestException('Remove the unused attachment before submitting.');
      return {
        attachmentType: null,
        attachmentUrl: null,
        attachmentKey: null,
        attachmentName: null,
        attachmentContentType: null,
        attachmentSize: null,
      };
    }
    if (mode === 'url') {
      if (file) throw new BadRequestException('Choose either a URL or a file, not both.');
      return {
        attachmentType: 'url',
        attachmentUrl: normalizeUrl(attachmentUrl),
        attachmentKey: null,
        attachmentName: null,
        attachmentContentType: null,
        attachmentSize: null,
      };
    }
    if (attachmentUrl) throw new BadRequestException('Choose either a URL or a file, not both.');
    if (!file) throw new BadRequestException('Choose a file to upload.');
    if (file.size > 10 * 1024 * 1024) throw new BadRequestException('Files must be 10 MB or smaller.');
    if (!allowedFileTypes.has(file.mimetype)) {
      throw new BadRequestException('Upload a PDF, document, spreadsheet, text file, or JPEG/PNG/WebP image.');
    }

    const key = `reports/${randomUUID()}-${safeFileName(file.originalname)}`;
    await this.storage.upload(key, file.buffer, file.mimetype);
    return {
      attachmentType: 'file',
      attachmentUrl: null,
      attachmentKey: key,
      attachmentName: safeFileName(file.originalname),
      attachmentContentType: file.mimetype,
      attachmentSize: file.size,
    };
  }

  private async toResponse(report: ReportRow, createdByUsername: string | null) {
    const attachment = report.attachmentType === 'url' && report.attachmentUrl
      ? { type: 'url', url: report.attachmentUrl }
      : report.attachmentType === 'file' && report.attachmentKey
        ? {
            type: 'file',
            url: await this.storage.signDownloadUrl(report.attachmentKey, report.attachmentName ?? 'report-file'),
            name: report.attachmentName,
            contentType: report.attachmentContentType,
            size: report.attachmentSize,
          }
        : null;
    return {
      id: report.id,
      reportDate: report.reportDate,
      reports: report.reportItems,
      createdBy: report.createdBy,
      createdByUsername,
      submittedAt: report.submittedAt,
      updatedAt: report.updatedAt,
      attachment,
      remarks: report.remarks,
    };
  }
}
