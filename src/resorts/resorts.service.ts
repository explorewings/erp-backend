import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../database.module';
import { images, resorts, tourPackages } from '../schema';
import { ResortRow } from '../schema/resorts';
import { StorageService } from '../storage/storage.service';
import { CreateResortDto } from './dto/create-resort.dto';
import { UpdateResortDto } from './dto/update-resort.dto';

export type Resort = {
  id: number;
  location: string;
  description: string | null;
  price: number;
  ratings: number;
  image1: string | null;
  image2: string | null;
  image3: string | null;
  created_at: Date;
};

@Injectable()
export class ResortsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly storage: StorageService,
  ) {}

  async create(dto: CreateResortDto): Promise<Resort> {
    const [created] = await this.db
      .insert(resorts)
      .values({
        location: dto.location.trim(),
        description: dto.description ?? null,
        price: dto.price,
        ...(dto.ratings === undefined ? {} : { ratings: dto.ratings }),
      })
      .returning();
    if (!created) throw new Error('Unable to create resort.');
    return (await this.mapToResort([created]))[0];
  }

  async list(params: { search?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(params.pageSize) || 20));
    const offset = (page - 1) * pageSize;
    const term = params.search?.trim();
    const where = term
      ? or(ilike(resorts.location, `%${term}%`), ilike(resorts.description, `%${term}%`))
      : undefined;

    const countRows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(resorts)
      .where(where);
    const total = countRows[0]?.count ?? 0;
    const rows = await this.db
      .select()
      .from(resorts)
      .where(where)
      .orderBy(desc(resorts.created_at), desc(resorts.id))
      .limit(pageSize)
      .offset(offset);

    const items = await this.mapToResort(rows);
    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async findOne(id: number): Promise<Resort> {
    const row = await this.findRow(id);
    return (await this.mapToResort([row]))[0];
  }

  async update(id: number, dto: UpdateResortDto): Promise<Resort> {
    await this.findRow(id);
    const updates: Partial<Pick<ResortRow, 'location' | 'description' | 'price' | 'ratings'>> = {};
    if (dto.location !== undefined) updates.location = dto.location.trim();
    if (dto.description !== undefined) updates.description = dto.description;
    if (dto.price !== undefined) updates.price = dto.price;
    if (dto.ratings !== undefined) updates.ratings = dto.ratings;

    if (Object.keys(updates).length) {
      await this.db.update(resorts).set(updates).where(eq(resorts.id, id));
    }
    return this.findOne(id);
  }

  async remove(id: number): Promise<{ id: number; cleanupWarnings: string[] }> {
    const [deleted] = await this.db
      .delete(resorts)
      .where(eq(resorts.id, id))
      .returning({
        id: resorts.id,
        image1Id: resorts.image1Id,
        image2Id: resorts.image2Id,
        image3Id: resorts.image3Id,
      });
    if (!deleted) throw new NotFoundException(`Resort ${id} not found`);

    const imageIds = [deleted.image1Id, deleted.image2Id, deleted.image3Id]
      .filter((imageId): imageId is number => imageId !== null);
    return { id: deleted.id, cleanupWarnings: await this.cleanupUnreferencedImages(imageIds) };
  }

  async assignImage(
    id: number,
    slot: number,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
  ) {
    const existing = await this.findRow(id);
    const field = this.imageField(slot);
    const previousImageId = existing[field];
    const key = `resorts/${id}/${slot}-${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    await this.storage.upload(key, file.buffer, file.mimetype);

    let uploadedImageId: number | undefined;
    try {
      const [image] = await this.db
        .insert(images)
        .values({ bucket: this.storage.getBucket(), key, mime: file.mimetype, size: file.size })
        .returning({ id: images.id });
      if (!image) throw new Error('Unable to save resort image metadata.');
      uploadedImageId = image.id;
      await this.db.update(resorts).set({ [field]: image.id }).where(eq(resorts.id, id));
    } catch (error) {
      if (uploadedImageId !== undefined) {
        await this.db.delete(images).where(eq(images.id, uploadedImageId)).catch(() => undefined);
      }
      await this.storage.delete(this.storage.getBucket(), key).catch(() => undefined);
      throw error;
    }

    const cleanupWarnings = previousImageId === null
      ? []
      : await this.cleanupUnreferencedImages([previousImageId]);
    return { ...(await this.findOne(id)), cleanupWarnings };
  }

  async clearImage(id: number, slot: number) {
    const existing = await this.findRow(id);
    const field = this.imageField(slot);
    const previousImageId = existing[field];
    await this.db.update(resorts).set({ [field]: null }).where(eq(resorts.id, id));
    const cleanupWarnings = previousImageId === null
      ? []
      : await this.cleanupUnreferencedImages([previousImageId]);
    return { ...(await this.findOne(id)), cleanupWarnings };
  }

  private async findRow(id: number): Promise<ResortRow> {
    const [row] = await this.db.select().from(resorts).where(eq(resorts.id, id)).limit(1);
    if (!row) throw new NotFoundException(`Resort ${id} not found`);
    return row;
  }

  private imageField(slot: number): 'image1Id' | 'image2Id' | 'image3Id' {
    return slot === 1 ? 'image1Id' : slot === 2 ? 'image2Id' : 'image3Id';
  }

  private async cleanupUnreferencedImages(imageIds: number[]): Promise<string[]> {
    const ids = [...new Set(imageIds)];
    if (!ids.length) return [];

    let imageRows: Array<typeof images.$inferSelect> = [];
    let resortReferences: Array<{
      image1Id: number | null;
      image2Id: number | null;
      image3Id: number | null;
    }> = [];
    let packageReferences: Array<{
      image1Id: number | null;
      image2Id: number | null;
      image3Id: number | null;
    }> = [];
    try {
      [imageRows, resortReferences, packageReferences] = await Promise.all([
        this.db.select().from(images).where(inArray(images.id, ids)),
        this.db
          .select({
            image1Id: resorts.image1Id,
            image2Id: resorts.image2Id,
            image3Id: resorts.image3Id,
          })
          .from(resorts)
          .where(or(
            inArray(resorts.image1Id, ids),
            inArray(resorts.image2Id, ids),
            inArray(resorts.image3Id, ids),
          )),
        this.db
          .select({
            image1Id: tourPackages.image1Id,
            image2Id: tourPackages.image2Id,
            image3Id: tourPackages.image3Id,
          })
          .from(tourPackages)
          .where(or(
            inArray(tourPackages.image1Id, ids),
            inArray(tourPackages.image2Id, ids),
            inArray(tourPackages.image3Id, ids),
          )),
      ]);
    } catch {
      return ['Resort was updated, but image references could not be checked for cleanup.'];
    }

    const referencedIds = new Set<number>();
    for (const row of [...resortReferences, ...packageReferences]) {
      for (const imageId of [row.image1Id, row.image2Id, row.image3Id]) {
        if (imageId !== null) referencedIds.add(imageId);
      }
    }
    const orphanedImages = imageRows.filter((image) => !referencedIds.has(image.id));
    const deletionResults = await Promise.allSettled(
      orphanedImages.map((image) => this.storage.delete(image.bucket, image.key)),
    );
    const deletedImageIds: number[] = [];
    const cleanupWarnings: string[] = [];

    deletionResults.forEach((result, index) => {
      const image = orphanedImages[index];
      if (result.status === 'fulfilled') deletedImageIds.push(image.id);
      else cleanupWarnings.push(`Image ${image.id} could not be removed from storage.`);
    });

    if (deletedImageIds.length) {
      try {
        await this.db.delete(images).where(inArray(images.id, deletedImageIds));
      } catch {
        cleanupWarnings.push('Image files were removed from storage, but some image records could not be removed.');
      }
    }
    return cleanupWarnings;
  }

  private async mapToResort(rows: ResortRow[]): Promise<Resort[]> {
    if (!rows.length) return [];
    const imageIds = [...new Set(rows.flatMap((row) =>
      [row.image1Id, row.image2Id, row.image3Id].filter((id): id is number => id !== null),
    ))];
    const keyById = new Map<number, string>();
    if (imageIds.length) {
      const imageRows = await this.db
        .select({ id: images.id, key: images.key })
        .from(images)
        .where(inArray(images.id, imageIds));
      for (const image of imageRows) keyById.set(image.id, image.key);
    }

    const keys = [...new Set(keyById.values())];
    const signedUrls = await Promise.all(keys.map((key) => this.storage.signGetUrl(key)));
    const signedByKey = new Map(keys.map((key, index) => [key, signedUrls[index]]));

    return rows.map((row) => {
      const signed = (imageId: number | null) => {
        const key = imageId === null ? undefined : keyById.get(imageId);
        return key ? signedByKey.get(key) ?? null : null;
      };
      return {
        id: row.id,
        location: row.location,
        description: row.description,
        price: Number(row.price),
        ratings: Number(row.ratings),
        image1: signed(row.image1Id),
        image2: signed(row.image2Id),
        image3: signed(row.image3Id),
        created_at: row.created_at,
      };
    });
  }
}
