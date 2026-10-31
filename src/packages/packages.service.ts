import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../database.module';
import { StorageService } from '../storage/storage.service';
import { ImageRow, images, tourPackages } from '../schema';

type PackageRow = typeof tourPackages.$inferSelect;

@Injectable()
export class PackagesService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb, private readonly storage: StorageService) {}

  async create(dto: any): Promise<any> {
    const values = {
      location: dto.location?.trim() || null,
      description: dto.description ?? null,
      category: dto.category?.trim() || null,
      totalDays: dto.totalDays === '' || dto.totalDays === null ? null : Number(dto.totalDays),
      price: dto.price === '' || dto.price === null ? null : Number(dto.price),
      ratings: dto.ratings === '' || dto.ratings === null ? null : Number(dto.ratings),
    };
    const rows = await this.db.insert(tourPackages).values(values as any).returning();
    const created = rows[0];
    if (!created) {
      throw new Error('Unable to create package.');
    }
    return (await this.mapToPackage([created]))[0];
  }

  async categories() {
    const rows = await this.db
      .selectDistinct({ category: tourPackages.category })
      .from(tourPackages)
      .orderBy(tourPackages.category);
    return rows.map((row) => row.category).filter(Boolean) as string[];
  }

  async list(params: { search?: string; category?: string; page?: number; pageSize?: number }) {
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

    const rows = await this.db
      .select()
      .from(tourPackages)
      .where(where)
      .orderBy(desc(tourPackages.createdAt), desc(tourPackages.id))
      .limit(pageSize)
      .offset(offset);

    const items = await this.mapToPackage(rows);
    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async update(id: number, dto: any) {
    const existing = await this.findOne(id).catch(() => null);
    const updates: Record<string, any> = {};

    if (dto.location !== undefined) updates.location = dto.location.trim();
    if (dto.description !== undefined) updates.description = dto.description;
    if (dto.category !== undefined) updates.category = dto.category.trim();
    if (dto.totalDays !== undefined) updates.totalDays = dto.totalDays === '' || dto.totalDays === null ? null : Number(dto.totalDays);
    if (dto.price !== undefined) updates.price = dto.price === '' || dto.price === null ? null : Number(dto.price);
    if (dto.ratings !== undefined) updates.ratings = dto.ratings === '' || dto.ratings === null ? null : Number(dto.ratings);

    if (Object.keys(updates).length > 0) {
      await this.db
        .update(tourPackages)
        .set(updates as any)
        .where(eq(tourPackages.id, id));
    }

    return this.findOne(id);
  }

  async assignImage(id: number, slot: number, file: { buffer: Buffer; originalname: string; mimetype: string; size: number }) {
    await this.findOne(id);
    const key = `packages/${id}/${slot}-${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    await this.storage.upload(key, file.buffer, file.mimetype);
    const image = await this.db
      .insert(images)
      .values({ bucket: this.storage.getBucket(), key, mime: file.mimetype, size: file.size })
      .returning()
      .then((rows) => rows[0]);
    const field = slot === 1 ? 'image1Id' : slot === 2 ? 'image2Id' : 'image3Id';
    await this.db.update(tourPackages).set({ [field]: (image as any).id } as any).where(eq(tourPackages.id, id));
    return this.findOne(id);
  }

  async clearImage(id: number, slot: number) {
    await this.findOne(id);
    const field = slot === 1 ? 'image1Id' : slot === 2 ? 'image2Id' : 'image3Id';
    await this.db.update(tourPackages).set({ [field]: null } as any).where(eq(tourPackages.id, id));
    return this.findOne(id);
  }

  async findOne(id: number) {
    const rows = await this.db.select().from(tourPackages).where(eq(tourPackages.id, id)).limit(1);
    if (!rows.length) throw new NotFoundException(`Package ${id} not found`);
    return (await this.mapToPackage(rows))[0];
  }

  private async mapToPackage(rows: PackageRow[]) {
    if (rows.length === 0) return [];
    const allImageIds = new Set<number>();
    for (const row of rows) {
      if (row.image1Id) allImageIds.add(row.image1Id);
      if (row.image2Id) allImageIds.add(row.image2Id);
      if (row.image3Id) allImageIds.add(row.image3Id);
    }
    const ids = Array.from(allImageIds);
    const keyById = new Map<number, string>();
    if (ids.length > 0) {
      const imageRows = await this.db
        .select({ id: images.id, key: images.key })
        .from(images)
        .where(inArray(images.id, ids));
      for (const img of imageRows) keyById.set(img.id, (img as any).key);
    }
    const uniqueKeys = Array.from(new Set(keyById.values()));
    const signed = new Map<string, string>();
    for (const key of uniqueKeys) {
      signed.set(key, await this.storage.signGetUrl(key));
    }
    return rows.map((row) => {
      const key1 = row.image1Id ? keyById.get(row.image1Id) ?? '' : '';
      const key2 = row.image2Id ? keyById.get(row.image2Id) ?? '' : '';
      const key3 = row.image3Id ? keyById.get(row.image3Id) ?? '' : '';
      return {
        id: row.id,
        location: row.location,
        description: row.description,
        category: row.category,
        totalDays: row.totalDays,
        price: row.price,
        ratings: row.ratings === null ? 4.4 : row.ratings,
        image1: (key1 && signed.get(key1)) || null,
        image2: (key2 && signed.get(key2)) || null,
        image3: (key3 && signed.get(key3)) || null,
        createdAt: row.createdAt,
      };
    });
  }
}
