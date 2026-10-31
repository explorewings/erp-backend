import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { desc, eq, ilike, or, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../database.module';
import { clients } from '../schema';
import { CreateClientDto } from './dto/create-client.dto';

@Injectable()
export class ClientsService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async list(params: { search?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(params.pageSize) || 100));
    const term = params.search?.trim();
    const where = term
      ? or(
          ilike(clients.name, `%${term}%`),
          ilike(clients.email, `%${term}%`),
          ilike(clients.phoneNumber, `%${term}%`),
        )
      : undefined;

    const countRows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(clients)
      .where(where);
    const total = countRows[0]?.count ?? 0;
    const items = await this.db
      .select()
      .from(clients)
      .where(where)
      .orderBy(desc(clients.createdAt), desc(clients.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async create(dto: CreateClientDto) {
    const email = dto.email?.trim() || null;
    const phoneNumber = dto.phoneNumber?.trim() || null;
    if (!email && !phoneNumber) {
      throw new BadRequestException('Provide an email address or phone number.');
    }

    const customFields = this.normalizeCustomFields(dto.customFields);
    const [created] = await this.db
      .insert(clients)
      .values({ name: dto.name.trim(), email, phoneNumber, customFields })
      .returning();
    if (!created) throw new Error('Unable to create client.');
    return created;
  }

  async update(id: number, dto: CreateClientDto) {
    const email = dto.email?.trim() || null;
    const phoneNumber = dto.phoneNumber?.trim() || null;
    if (!email && !phoneNumber) {
      throw new BadRequestException('Provide an email address or phone number.');
    }

    const customFields = this.normalizeCustomFields(dto.customFields);
    const [updated] = await this.db
      .update(clients)
      .set({ name: dto.name.trim(), email, phoneNumber, customFields })
      .where(eq(clients.id, id))
      .returning();
    return updated ?? null;
  }

  async remove(id: number) {
    const [deleted] = await this.db
      .delete(clients)
      .where(eq(clients.id, id))
      .returning({ id: clients.id });
    return deleted ?? null;
  }

  private normalizeCustomFields(fields?: Record<string, string>): Record<string, string> {
    if (!fields) return {};
    const rawEntries = Object.entries(fields);
    if (rawEntries.length > 50) {
      throw new BadRequestException('A client can have at most 50 custom fields.');
    }

    const entries = rawEntries
      .map(([key, value]) => {
        if (typeof value !== 'string') {
          throw new BadRequestException('Custom field values must be text.');
        }
        return [key.trim(), value.trim()] as const;
      })
      .filter(([key, value]) => key && value);

    if (entries.some(([key, value]) => key.length > 100 || value.length > 1000)) {
      throw new BadRequestException('Custom field names must be at most 100 characters and values at most 1000 characters.');
    }

    const normalizedKeys = new Set<string>();
    for (const [key] of entries) {
      const normalizedKey = key.toLowerCase();
      if (normalizedKeys.has(normalizedKey)) {
        throw new BadRequestException(`Custom field "${key}" is duplicated.`);
      }
      normalizedKeys.add(normalizedKey);
    }

    return Object.fromEntries(entries);
  }
}
