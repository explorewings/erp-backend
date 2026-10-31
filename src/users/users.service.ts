import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
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
}
