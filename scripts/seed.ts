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
      status text NOT NULL DEFAULT 'active',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX users_email_unique_idx ON users (email);
    CREATE UNIQUE INDEX users_username_unique_idx ON users (username);

    CREATE TABLE IF NOT EXISTS access_items (
      code text PRIMARY KEY,
      type text NOT NULL DEFAULT 'menu',
      name text NOT NULL,
      description text,
      display_order integer NOT NULL DEFAULT 0,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    INSERT INTO access_items (code, type, name, description, display_order) VALUES
      ('menu:calendar', 'menu', 'Calendar', 'Bookings and schedules in one view.', 1),
      ('menu:clients', 'menu', 'Clients', 'Customer records and their details.', 2),
      ('menu:crm', 'menu', 'CRM', 'Pipeline, leads, and follow-ups.', 3),
      ('menu:resorts', 'menu', 'Resorts', 'Resort listings, pricing, and imagery.', 4),
      ('menu:packages', 'menu', 'Packages', 'Itineraries, durations, and pricing.', 5),
      ('menu:settings', 'menu', 'Settings', 'Workspace preferences.', 6)
    ON CONFLICT (code) DO NOTHING;

    CREATE TABLE IF NOT EXISTS access (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code text NOT NULL REFERENCES access_items(code) ON DELETE CASCADE,
      type text NOT NULL DEFAULT 'menu',
      allowed boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT access_user_code_unique UNIQUE (user_id, code)
    );
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
      status: 'active',
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        username: SUPERADMIN.username,
        passwordHash,
        role: SUPERADMIN.role,
        status: 'active',
      },
    });

  console.log(`Seed complete: user "${SUPERADMIN.username}" <${email}> is ready.`);

  await pool.end();
}

main().catch((error) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
});
