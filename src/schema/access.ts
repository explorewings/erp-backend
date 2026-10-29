import {
  boolean,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const access = pgTable(
  'access',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    code: text('code').notNull(),
    type: text('type').notNull().default('menu'),
    allowed: boolean('allowed').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('access_user_code_unique_idx').on(table.userId, table.code),
  ],
);

export type AccessRow = typeof access.$inferSelect;
export type NewAccessRow = typeof access.$inferInsert;
