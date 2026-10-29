import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../database.module';
import { tourPackages } from '../schema/packages';

@Injectable()
export class PackagesService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async categories() {
    const rows = await this.db
      .selectDistinct({ category: tourPackages.category })
      .from(tourPackages)
      .orderBy(tourPackages.category);
    return rows.map((row) => row.category).filter(Boolean) as string[];
  }

  async list(params: {
    search?: string;
    category?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(params.pageSize) || 20));
    const offset = (page - 1) * pageSize;

    const conditions = [] as any[];
    const term = params.search?.trim();
    if (term) {
      conditions.push(or(ilike(tourPackages.location, `%${term}%`), ilike(tourPackages.description, `%${term}%`)));
    }
    if (params.category && params.category !== 'all') {
      conditions.push(eq(tourPackages.category, params.category));
    }
    const where = conditions.length ? and(...conditions) : undefined;

    const countRows = await this.db.select({ count: sql<number>`count(*)::int` }).from(tourPackages).where(where);
    const total = countRows[0]?.count ?? 0;

    const items = await this.db
      .select()
      .from(tourPackages)
      .where(where)
      .orderBy(desc(tourPackages.createdAt), desc(tourPackages.id))
      .limit(pageSize)
      .offset(offset);

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }
}
