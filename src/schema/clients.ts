import { check, index, integer, jsonb, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { clientImports } from './client-imports';

export const clients = pgTable(
  'clients',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email'),
    phoneNumber: text('phone_number'),
    customFields: jsonb('custom_fields').$type<Record<string, string>>().notNull().default({}),
    importId: integer('import_id').references(() => clientImports.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    contactRequired: check(
      'clients_email_or_phone_required',
      sql`NULLIF(BTRIM(${table.email}), '') IS NOT NULL OR NULLIF(BTRIM(${table.phoneNumber}), '') IS NOT NULL`,
    ),
    importIdIdx: index('clients_import_id_idx').on(table.importId),
  }),
);

export type ClientRow = typeof clients.$inferSelect;
export type NewClientRow = typeof clients.$inferInsert;
