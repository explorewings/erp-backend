import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../database.module';
import { AccessItemRow, AccessRow, NewAccessRow, access, accessItems, users } from '../schema';

@Injectable()
export class AccessService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  list(userId: string): Promise<AccessRow[]> {
    return this.db.query.access.findMany({ where: (table, { eq }) => eq(table.userId, userId) });
  }

  async getAllowedCodes(userId: string): Promise<string[]> {
    const rows = await this.db.query.access.findMany({
      where: (table, { and, eq }) => and(eq(table.userId, userId), eq(table.allowed, true)),
    });
    return rows.map((row) => row.code);
  }

  async replaceForUser(userId: string, codes: string[]): Promise<AccessRow[]> {
    await this.db.delete(access).where(eq(access.userId, userId));
    if (codes.length === 0) return [];
    const values: NewAccessRow[] = codes.map((code) => ({ userId, code, type: 'menu', allowed: true }));
    return this.db.insert(access).values(values).returning();
  }

  async listByCode(code: string): Promise<AccessRow[]> {
    return this.db.query.access.findMany({ where: (table, { eq }) => eq(table.code, code) });
  }

  async setMenuAccess(code: string, selectedUserIds: string[]): Promise<AccessRow[]> {
    const selected = new Set(selectedUserIds);
    const rows = await this.db.query.users.findMany({});
    const result: AccessRow[] = [];
    for (const user of rows) {
      await this.db
        .insert(access)
        .values({ userId: user.id, code, type: 'menu', allowed: selected.has(user.id) })
        .onConflictDoUpdate({
          target: [access.userId, access.code],
          set: { allowed: selected.has(user.id) },
        });
    }
    return this.db.query.access.findMany({ where: (table, { eq }) => eq(table.code, code) });
  }

  async getAccessItems(type?: string): Promise<AccessItemRow[]> {
    const rows = await this.db.query.accessItems.findMany({
      where: (table, { eq }) => (type ? eq(table.type, type) : undefined),
      orderBy: (table, { asc }) => asc(table.displayOrder),
    });
    return rows.filter((row) => row.isActive);
  }

  async isSuperuser(userId: string): Promise<boolean> {
    const user = await this.db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, userId) });
    return user?.role === 'superadmin' || user?.role === 'superuser';
  }
}
