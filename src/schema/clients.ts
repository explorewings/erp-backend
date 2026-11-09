import { check, index, integer, jsonb, pgTable, serial, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { clientImports } from './client-imports';
import { users } from './users';

/** Where a client first entered the system: typed in, or bulk-imported. */
export const clientSources = ['manual', 'imported'] as const;
export type ClientSource = (typeof clientSources)[number];

export const clients = pgTable(
  'clients',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email'),
    phoneNumber: text('phone_number'),
    customFields: jsonb('custom_fields').$type<Record<string, string>>().notNull().default({}),
    importId: integer('import_id').references(() => clientImports.id, { onDelete: 'set null' }),
    source: text('source').notNull().default('manual').$type<ClientSource>(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    contactRequired: check(
      'clients_email_or_phone_required',
      sql`NULLIF(BTRIM(${table.email}), '') IS NOT NULL OR NULLIF(BTRIM(${table.phoneNumber}), '') IS NOT NULL`,
    ),
    sourceValid: check('clients_source_valid', sql`${table.source} IN ('manual', 'imported')`),
    importIdIdx: index('clients_import_id_idx').on(table.importId),
    createdByIdx: index('clients_created_by_idx').on(table.createdBy),
  }),
);

/**
 * Thread/audit log for one client (mirrors calendar_event_log).
 * `action` is 'created' | 'updated'; `meta` carries { source, importId,
 * importName?, changedFields? }.
 */
export const clientActivityLog = pgTable(
  'client_activity_log',
  {
    id: serial('id').primaryKey(),
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    meta: jsonb('meta'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clientIdx: index('client_activity_log_client_idx').on(table.clientId),
    createdIdx: index('client_activity_log_created_idx').on(table.createdAt),
  }),
);

export type ClientRow = typeof clients.$inferSelect;
export type NewClientRow = typeof clients.$inferInsert;
export type ClientActivityRow = typeof clientActivityLog.$inferSelect;
