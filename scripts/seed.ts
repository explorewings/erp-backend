import 'dotenv/config';
import * as bcrypt from 'bcryptjs';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { users } from '../src/schema';

const SUPERADMIN = {
  username: 'superadmin',
  email: 'infoexplorewings@gmail.com',
  password: 'Admin@12345',
  role: 'superadmin',
};

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set — check erpnestbackend/.env');
  }

  const pool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });
  const db = drizzle(pool);

  // Drop and recreate so the id column migrates from serial to uuid.
  await pool.query(`DROP TABLE IF EXISTS users;`);

  await pool.query(`
    CREATE TABLE users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      username text NOT NULL,
      email text NOT NULL,
      password_hash text NOT NULL,
      role text NOT NULL DEFAULT 'user',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX users_email_unique_idx ON users (email);
    CREATE UNIQUE INDEX users_username_unique_idx ON users (username);
  `);

  const email = SUPERADMIN.email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(SUPERADMIN.password, 12);

  await db
    .insert(users)
    .values({
      username: SUPERADMIN.username,
      email,
      passwordHash,
      role: SUPERADMIN.role,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        username: SUPERADMIN.username,
        passwordHash,
        role: SUPERADMIN.role,
      },
    });

  console.log(`Seed complete: user "${SUPERADMIN.username}" <${email}> is ready.`);

  await pool.end();
}

main().catch((error) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
});
