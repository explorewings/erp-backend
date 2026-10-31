import { check, jsonb, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const clients = pgTable(
  'clients',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email'),
    phoneNumber: text('phone_number'),
    customFields: jsonb('custom_fields').$type<Record<string, string>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    contactRequired: check(
      'clients_email_or_phone_required',
      sql`NULLIF(BTRIM(${table.email}), '') IS NOT NULL OR NULLIF(BTRIM(${table.phoneNumber}), '') IS NOT NULL`,
    ),
  }),
);

export type ClientRow = typeof clients.$inferSelect;
export type NewClientRow = typeof clients.$inferInsert;
