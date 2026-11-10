import { Inject, Injectable } from '@nestjs/common';
import { and, eq, ilike, or, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../database.module';
import { NewUserRow, UserRow, users } from '../schema';

@Injectable()
export class UsersService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  findByEmail(email: string): Promise<UserRow | undefined> {
    return this.db.query.users.findFirst({
      where: eq(users.email, email.trim().toLowerCase()),
    });
  }

  findByUsername(username: string): Promise<UserRow | undefined> {
    return this.db.query.users.findFirst({
      where: eq(users.username, username.trim()),
    });
  }

  findAll(): Promise<Omit<UserRow, 'passwordHash'>[]> {
    return this.db.query.users
      .findMany({
        orderBy: (t, { desc }) => desc(t.createdAt),
      })
      .then((rows) =>
        rows.map(({ passwordHash: _passwordHash, ...rest }) => rest),
      );
  }

  /** Debounced type-ahead search used by pickers (e.g. filter reports by user). */
  async search(
    term: string | undefined,
    limit = 20,
  ): Promise<{ items: Omit<UserRow, 'passwordHash'>[]; total: number }> {
    const trimmed = term?.trim();
    const where = trimmed
      ? or(ilike(users.username, `%${trimmed}%`), ilike(users.email, `%${trimmed}%`))
      : undefined;

    const [countRows, rows] = await Promise.all([
      this.db.select({ count: sql<number>`count(*)::int` }).from(users).where(where),
      this.db.query.users.findMany({
        where,
        orderBy: (t, { asc }) => asc(t.username),
        limit,
      }),
    ]);

    return {
      items: rows.map(({ passwordHash: _passwordHash, ...rest }) => rest),
      total: countRows[0]?.count ?? 0,
    };
  }
}
