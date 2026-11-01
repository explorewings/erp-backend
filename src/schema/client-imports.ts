import { check, index, integer, pgTable, serial, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';

export const clientImports = pgTable(
  'client_imports',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    status: text('status')
      .$type<'processing' | 'completed' | 'failed'>()
      .notNull()
      .default('processing'),
    totalRows: integer('total_rows').notNull(),
    importedRows: integer('imported_rows').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => ({
    validStatus: check(
      'client_imports_status_valid',
      sql`${table.status} IN ('processing', 'completed', 'failed')`,
    ),
    validRowCounts: check(
      'client_imports_row_counts_valid',
      sql`${table.totalRows} BETWEEN 1 AND 500 AND ${table.importedRows} BETWEEN 0 AND ${table.totalRows}`,
    ),
    createdAtIdx: index('client_imports_created_at_idx').on(table.createdAt),
  }),
);

export type ClientImportRow = typeof clientImports.$inferSelect;
