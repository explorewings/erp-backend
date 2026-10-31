import { integer, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const images = pgTable(
  'images',
  {
    id: serial('id').primaryKey(),
    bucket: text('bucket').notNull().default('assets'),
    key: text('key').notNull(),
    mime: text('mime'),
    size: integer('size'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('images_bucket_key_uq').on(table.bucket, table.key)],
);

export type ImageRow = typeof images.$inferSelect;
