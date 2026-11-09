import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../database.module';
import { clientActivityLog, clientImports, clients, users } from '../schema';
import { CreateClientDto } from './dto/create-client.dto';

/** Fields the list returns, plus provenance for the details History tab. */
const clientWithProvenance = {
  id: clients.id,
  name: clients.name,
  email: clients.email,
  phoneNumber: clients.phoneNumber,
  customFields: clients.customFields,
  importId: clients.importId,
  source: clients.source,
  createdBy: clients.createdBy,
  createdByUsername: users.username,
  importName: clientImports.name,
  createdAt: clients.createdAt,
  updatedAt: clients.updatedAt,
};

export type ClientActivityMeta = {
  source?: string;
  importId?: number | null;
  importName?: string | null;
  via?: string;
  pipelineId?: number;
  pipelineName?: string | null;
  changedFields?: string[];
};

/** Write one activity-log entry. Accepts a tx handle or the main db. */
export async function logClientActivity(
  db: DrizzleDb | any,
  input: { clientId: number; actorId?: string | null; action: 'created' | 'updated' | 'added_to_pipeline'; meta?: ClientActivityMeta },
) {
  await db.insert(clientActivityLog).values({
    clientId: input.clientId,
    actorId: input.actorId ?? null,
    action: input.action,
    meta: input.meta ?? null,
  });
}

/**
 * Write many activity-log entries in ONE statement (bulk add / import
 * batches). One insert per row was the main slowdown in bulk operations.
 */
export async function logClientActivities(
  db: DrizzleDb | any,
  inputs: { clientId: number; actorId?: string | null; action: 'created' | 'updated' | 'added_to_pipeline'; meta?: ClientActivityMeta }[],
) {
  if (!inputs.length) return;
  await db.insert(clientActivityLog).values(
    inputs.map((input) => ({
      clientId: input.clientId,
      actorId: input.actorId ?? null,
      action: input.action,
      meta: input.meta ?? null,
    })),
  );
}

@Injectable()
export class ClientsService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async list(params: { search?: string; page?: number; pageSize?: number; importId?: number }) {
    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(params.pageSize) || 100));
    const term = params.search?.trim();
    const searchFilter = term
      ? or(
          ilike(clients.name, `%${term}%`),
          ilike(clients.email, `%${term}%`),
          ilike(clients.phoneNumber, `%${term}%`),
        )
      : undefined;
    const where = params.importId
      ? searchFilter
        ? and(eq(clients.importId, params.importId), searchFilter)
        : eq(clients.importId, params.importId)
      : searchFilter;

    const countRows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(clients)
      .where(where);
    const total = countRows[0]?.count ?? 0;
    const items = await this.db
      .select(clientWithProvenance)
      .from(clients)
      .leftJoin(users, eq(users.id, clients.createdBy))
      .leftJoin(clientImports, eq(clientImports.id, clients.importId))
      .where(where)
      .orderBy(desc(clients.createdAt), desc(clients.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async create(dto: CreateClientDto, actorId?: string | null) {
    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(clients)
        .values({ ...this.normalizeClientInput(dto), source: 'manual', createdBy: actorId ?? null })
        .returning();
      if (!created) throw new Error('Unable to create client.');
      await logClientActivity(tx, { clientId: created.id, actorId, action: 'created', meta: { source: 'manual' } });
      return this.withProvenance(tx, created.id);
    });
  }

  async update(id: number, dto: CreateClientDto, actorId?: string | null) {
    const input = this.normalizeClientInput(dto);
    return this.db.transaction(async (tx) => {
      const [existing] = await tx.select().from(clients).where(eq(clients.id, id)).limit(1);
      if (!existing) return null;
      const changedFields: string[] = (['name', 'email', 'phoneNumber'] as const).filter(
        (field) => (existing[field] ?? null) !== (input[field] ?? null),
      );
      const oldKeys = new Set(Object.keys(existing.customFields || {}));
      const newKeys = new Set(Object.keys(input.customFields || {}));
      const customChanged =
        oldKeys.size !== newKeys.size ||
        [...newKeys].some((key) => (existing.customFields || {})[key] !== input.customFields[key]);
      if (customChanged) changedFields.push('customFields');
      const [updated] = await tx
        .update(clients)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(clients.id, id))
        .returning();
      if (!updated) return null;
      if (changedFields.length) {
        await logClientActivity(tx, { clientId: id, actorId, action: 'updated', meta: { changedFields } });
      }
      return this.withProvenance(tx, id);
    });
  }

  /** One client with provenance (adder username + import name), or null. */
  private async withProvenance(db: DrizzleDb | any, id: number) {
    const [row] = await db
      .select(clientWithProvenance)
      .from(clients)
      .leftJoin(users, eq(users.id, clients.createdBy))
      .leftJoin(clientImports, eq(clientImports.id, clients.importId))
      .where(eq(clients.id, id))
      .limit(1);
    return row ?? null;
  }

  /** Thread history for one client, latest first, 20 per page (calendar-style). */
  async history(id: number, page = 1) {
    const [existing] = await this.db.select({ id: clients.id }).from(clients).where(eq(clients.id, id)).limit(1);
    if (!existing) throw new NotFoundException(`Client ${id} not found`);
    const pageSize = 20;
    const offset = (Math.max(1, Number(page) || 1) - 1) * pageSize;
    const rows = await this.db
      .select({
        id: clientActivityLog.id,
        action: clientActivityLog.action,
        meta: clientActivityLog.meta,
        createdAt: clientActivityLog.createdAt,
        actor: { id: users.id, username: users.username },
      })
      .from(clientActivityLog)
      .leftJoin(users, eq(users.id, clientActivityLog.actorId))
      .where(eq(clientActivityLog.clientId, id))
      .orderBy(desc(clientActivityLog.createdAt), desc(clientActivityLog.id))
      .limit(pageSize + 1)
      .offset(offset);
    const hasMore = rows.length > pageSize;
    return { items: hasMore ? rows.slice(0, pageSize) : rows, hasMore, page: Math.max(1, Number(page) || 1) };
  }

  async remove(id: number) {
    const [deleted] = await this.db
      .delete(clients)
      .where(eq(clients.id, id))
      .returning({ id: clients.id });
    return deleted ?? null;
  }

  async removeMany(ids: number[]) {
    if (!ids.length || ids.length > 100) {
      throw new BadRequestException('Delete between 1 and 100 clients per batch.');
    }

    const uniqueIds = [...new Set(ids)];
    const deleted = await this.db
      .delete(clients)
      .where(inArray(clients.id, uniqueIds))
      .returning({ id: clients.id });
    return { deletedCount: deleted.length };
  }

  async removeImportBatch(importId: number) {
    return this.db.transaction(async (tx) => {
      const [clientImport] = await tx
        .select({ id: clientImports.id, status: clientImports.status })
        .from(clientImports)
        .where(eq(clientImports.id, importId))
        .for('update');
      if (!clientImport) throw new NotFoundException('Client import not found.');
      if (clientImport.status === 'processing') {
        throw new BadRequestException('Wait for the client import to finish before deleting it.');
      }

      const batch = await tx
        .select({ id: clients.id })
        .from(clients)
        .where(eq(clients.importId, importId))
        .orderBy(clients.id)
        .limit(100);

      const deleted = batch.length
        ? await tx
            .delete(clients)
            .where(inArray(clients.id, batch.map(({ id }) => id)))
            .returning({ id: clients.id })
        : [];
      const [remaining] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(clients)
        .where(eq(clients.importId, importId));

      return {
        deletedCount: deleted.length,
        remainingCount: remaining?.count ?? 0,
      };
    });
  }

  normalizeClientInput(dto: CreateClientDto) {
    const name = dto.name?.trim();
    const email = dto.email?.trim() || null;
    const phoneNumber = dto.phoneNumber?.trim() || null;
    if (!name || name.length > 200) {
      throw new BadRequestException('Client names must be between 1 and 200 characters.');
    }
    if (!email && !phoneNumber) {
      throw new BadRequestException('Provide an email address or phone number.');
    }

    return {
      name,
      email,
      phoneNumber,
      customFields: this.normalizeCustomFields(dto.customFields),
    };
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
