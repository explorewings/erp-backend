import { integer, pgTable, real, text, timestamp } from 'drizzle-orm/pg-core';

export const tourPackages = pgTable('tour_packages', {
  id: integer('id').primaryKey(),
  location: text('location'),
  description: text('description'),
  category: text('category'),
  totalDays: integer('total_days'),
  price: integer('price'),
  ratings: real('ratings'),
  image1: text('image1'),
  image2: text('image2'),
  image3: text('image3'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export type PackageRow = typeof tourPackages.$inferSelect;
export type NewPackageRow = typeof tourPackages.$inferInsert;
