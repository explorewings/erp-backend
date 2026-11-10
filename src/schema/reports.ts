import { sql } from 'drizzle-orm';
import { check, date, index, integer, jsonb, pgTable, serial, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

export const reports = pgTable(
  'reports',
  {
    id: serial('id').primaryKey(),
    reportDate: date('report_date', { mode: 'string' }).notNull(),
    reportItems: jsonb('reports').$type<string[]>().notNull().default([]),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    attachmentType: text('attachment_type'),
    attachmentUrl: text('attachment_url'),
    attachmentKey: text('attachment_key'),
    attachmentName: text('attachment_name'),
    attachmentContentType: text('attachment_content_type'),
    attachmentSize: integer('attachment_size'),
    remarks: text('remarks'),
  },
  (table) => [
    check('reports_items_array', sql`jsonb_typeof(${table.reportItems}) = 'array'`),
    check(
      'reports_attachment_type_valid',
      sql`${table.attachmentType} IS NULL OR ${table.attachmentType} IN ('url', 'file')`,
    ),
    check(
      'reports_attachment_size_nonnegative',
      sql`${table.attachmentSize} IS NULL OR ${table.attachmentSize} >= 0`,
    ),
    check(
      'reports_attachment_shape',
      sql`(
        (${table.attachmentType} IS NULL AND ${table.attachmentUrl} IS NULL AND ${table.attachmentKey} IS NULL
          AND ${table.attachmentName} IS NULL AND ${table.attachmentContentType} IS NULL AND ${table.attachmentSize} IS NULL)
        OR (${table.attachmentType} = 'url' AND ${table.attachmentUrl} IS NOT NULL AND ${table.attachmentKey} IS NULL
          AND ${table.attachmentName} IS NULL AND ${table.attachmentContentType} IS NULL AND ${table.attachmentSize} IS NULL)
        OR (${table.attachmentType} = 'file' AND ${table.attachmentUrl} IS NULL AND ${table.attachmentKey} IS NOT NULL
          AND ${table.attachmentName} IS NOT NULL AND ${table.attachmentContentType} IS NOT NULL AND ${table.attachmentSize} IS NOT NULL)
      )`,
    ),
    index('reports_report_date_idx').on(table.reportDate),
    index('reports_created_by_idx').on(table.createdBy),
    index('reports_submitted_at_idx').on(table.submittedAt),
  ],
);

export type ReportRow = typeof reports.$inferSelect;
