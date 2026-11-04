import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users';

export const calendarEventTypes = [
  'task',
  'announcement',
  'meeting',
] as const;

export type CalendarEventType = (typeof calendarEventTypes)[number];

export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: serial('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description'),
    type: text('type').notNull().$type<CalendarEventType>(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    location: text('location'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('calendar_events_title_not_empty', sql`BTRIM(${table.title}) <> ''`),
    check('calendar_events_type_valid', sql`${table.type} IN ('task', 'announcement', 'meeting')`),
    check(
      'calendar_events_ends_after_starts',
      sql`${table.endsAt} IS NULL OR ${table.endsAt} >= ${table.startsAt}`,
    ),
    index('calendar_events_starts_at_idx').on(table.startsAt),
    index('calendar_events_type_idx').on(table.type),
    index('calendar_events_created_by_idx').on(table.createdBy),
  ],
);

export const calendarAssignees = pgTable(
  'calendar_assignees',
  {
    eventId: integer('event_id')
      .notNull()
      .references(() => calendarEvents.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('calendar_assignees_event_id_idx').on(table.eventId),
    index('calendar_assignees_user_id_idx').on(table.userId),
  ],
);

export type CalendarEventRow = typeof calendarEvents.$inferSelect;
export type NewCalendarEventRow = typeof calendarEvents.$inferInsert;
export type CalendarAssigneeRow = typeof calendarAssignees.$inferSelect;
