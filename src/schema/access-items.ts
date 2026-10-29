import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const accessItems = pgTable(
  'access_items',
  {
    code: text('code').primaryKey(),
    type: text('type').notNull().default('menu'),
    name: text('name').notNull(),
    description: text('description'),
    displayOrder: integer('display_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex('access_items_code_unique_idx').on(table.code)],
);

export type AccessItemRow = typeof accessItems.$inferSelect;
export type NewAccessItemRow = typeof accessItems.$inferInsert;
