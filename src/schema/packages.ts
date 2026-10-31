import { integer, pgTable, real, text, timestamp } from 'drizzle-orm/pg-core';

export const tourPackages = pgTable('tour_packages', {
  id: integer('id').primaryKey(),
  location: text('location'),
  description: text('description'),
  category: text('category'),
  totalDays: integer('total_days'),
  price: integer('price'),
  ratings: real('ratings'),
  image1Id: integer('image1_id'),
  image2Id: integer('image2_id'),
  image3Id: integer('image3_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export type PackageRow = typeof tourPackages.$inferSelect;
export type NewPackageRow = typeof tourPackages.$inferInsert;
