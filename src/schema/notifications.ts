import { jsonb, pgTable, serial, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

/* Mirrors src/db/migrations/0013_create_notifications.sql. */
export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
  module: text('module').notNull(),
  kind: text('kind').notNull(),
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  title: text('title').notNull(),
  body: text('body'),
  link: text('link'),
  meta: jsonb('meta'),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type NotificationRow = typeof notifications.$inferSelect;
export type NewNotificationRow = typeof notifications.$inferInsert;
