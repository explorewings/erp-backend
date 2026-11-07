import { integer, jsonb, pgTable, serial, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

/* Calendar v2 — mirrors migrations 0011_calendar_v2.sql and 0012_calendar_extension_requests.sql (constraints live there). */

export const calendarEventTypes = ['task', 'announcement', 'meeting', 'followup'] as const;
export type CalendarEventType = (typeof calendarEventTypes)[number];

export const calendarEvents = pgTable('calendar_events', {
  id: serial('id').primaryKey(),
  type: text('type').notNull().$type<CalendarEventType>(),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  location: text('location'),
  visibility: text('visibility'),
  priority: text('priority'),
  imageUrl: text('image_url'),
  assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'restrict' }),
  previousStatus: text('previous_status'),
  holdReason: text('hold_reason'),
  holdUntil: timestamp('hold_until', { withTimezone: true }),
  cancelReason: text('cancel_reason'),
  rejectCount: integer('reject_count').notNull().default(0),
  completionRemarks: text('completion_remarks'),
  extensionUntil: timestamp('extension_until', { withTimezone: true }),
  extensionReason: text('extension_reason'),
  version: integer('version').notNull().default(1),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedBy: uuid('deleted_by').references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const calendarMeetingMembers = pgTable(
  'calendar_meeting_members',
  {
    eventId: integer('event_id')
      .notNull()
      .references(() => calendarEvents.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('calendar_meeting_members_unique').on(table.eventId, table.userId)],
);

export const calendarEventLog = pgTable('calendar_event_log', {
  id: serial('id').primaryKey(),
  eventId: integer('event_id')
    .notNull()
    .references(() => calendarEvents.id, { onDelete: 'cascade' }),
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'restrict' }),
  action: text('action').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status'),
  reason: text('reason'),
  meta: jsonb('meta'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CalendarEventRow = typeof calendarEvents.$inferSelect;
export type NewCalendarEventRow = typeof calendarEvents.$inferInsert;
export type CalendarLogRow = typeof calendarEventLog.$inferSelect;
