import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../database.module';
import { AccessItemRow, AccessRow, NewAccessRow, access, accessItems } from '../schema';

@Injectable()
export class AccessService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  list(userId: string): Promise<AccessRow[]> {
    return this.db.query.access.findMany({ where: (table, { eq }) => eq(table.userId, userId) });
  }

  async getAllowedCodes(userId: string): Promise<string[]> {
    const [user, menuItems, rows] = await Promise.all([
      this.db.query.users.findFirst({ where: (table, { eq }) => eq(table.id, userId) }),
      this.db.query.accessItems.findMany({
        where: (table, { and, eq }) => and(eq(table.type, 'menu'), eq(table.isActive, true)),
      }),
      this.db.query.access.findMany({
        where: (table, { and, eq }) => and(eq(table.userId, userId), eq(table.allowed, true)),
      }),
    ]);
    if (user?.role === 'superadmin' || user?.role === 'superuser') {
      return menuItems.map((item) => item.code);
    }
    const activeCodes = new Set(
      menuItems
        .filter((item) => item.code !== 'menu:settings')
        .map((item) => item.code),
    );
    return rows.filter((row) => activeCodes.has(row.code)).map((row) => row.code);
  }

  async replaceForUser(userId: string, codes: string[]): Promise<AccessRow[]> {
    return this.db.transaction(async (tx) => {
      await tx.delete(access).where(eq(access.userId, userId));
      const selected = new Set(codes);
      const menuItems = await tx
        .select({ code: accessItems.code })
        .from(accessItems)
        .where(and(eq(accessItems.type, 'menu'), eq(accessItems.isActive, true)));
      const values: NewAccessRow[] = menuItems
        .filter(({ code }) => code !== 'menu:settings' && selected.has(code))
        .map(({ code }) => ({
          userId,
          code,
          type: 'menu',
          allowed: true,
        }));
      if (values.length === 0) return [];
      return tx.insert(access).values(values).returning();
    });
  }

  async listByCode(code: string): Promise<AccessRow[]> {
    return this.db.query.access.findMany({ where: (table, { eq }) => eq(table.code, code) });
  }

  async setMenuAccess(code: string, selectedUserIds: string[]): Promise<AccessRow[]> {
    const selected = new Set(selectedUserIds);
    const users = await this.db.query.users.findMany({});
    const grantIds = users
      .filter((user) => user.role !== 'superadmin' && user.role !== 'superuser' && selected.has(user.id))
      .map((user) => user.id);
    await this.db.transaction(async (tx) => {
      await tx.delete(access).where(eq(access.code, code));
      if (grantIds.length > 0) {
        await tx.insert(access).values(
          grantIds.map((userId) => ({ userId, code, type: 'menu', allowed: true })),
        );
      }
    });
    return grantIds.length
      ? this.db.query.access.findMany({
          where: (table, { and, eq }) => and(eq(table.code, code), inArray(table.userId, grantIds)),
        })
      : [];
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

  async getUserRole(userId: string): Promise<string | null> {
    const user = await this.db.query.users.findFirst({ where: (table, { eq }) => eq(table.id, userId) });
    return user?.role ?? null;
  }

  async hasMenuAccess(userId: string, code: string): Promise<boolean> {
    const role = await this.getUserRole(userId);
    if (role === 'superadmin' || role === 'superuser') return true;

    const [menuItem, grant] = await Promise.all([
      this.db.query.accessItems.findFirst({
        where: (table, { and, eq }) => and(
          eq(table.code, code),
          eq(table.type, 'menu'),
          eq(table.isActive, true),
        ),
      }),
      this.db.query.access.findFirst({
        where: (table, { and, eq }) => and(
          eq(table.userId, userId),
          eq(table.code, code),
          eq(table.allowed, true),
        ),
      }),
    ]);
    return Boolean(menuItem && grant);
  }
}
