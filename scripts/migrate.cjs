const fs = require('node:fs/promises')
const path = require('node:path')
const dotenv = require('dotenv')
const { Pool } = require('pg')

dotenv.config()

async function migrate() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Configure erpnestbackend/.env before migrating.')
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  })

  try {
    const client = await pool.connect()
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS app_migrations (
          name TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `)
      await client.query('SELECT pg_advisory_lock($1)', [814506243])

      const migrationsDirectory = path.resolve(__dirname, '../src/db/migrations')
      const files = (await fs.readdir(migrationsDirectory))
        .filter((name) => /^\d+_.+\.sql$/.test(name))
        .sort()

      for (const name of files) {
        const alreadyApplied = await client.query(
          'SELECT 1 FROM app_migrations WHERE name = $1',
          [name],
        )
        if (alreadyApplied.rowCount) continue

        const sql = await fs.readFile(path.join(migrationsDirectory, name), 'utf8')
        await client.query('BEGIN')
        try {
          await client.query(sql)
          await client.query('INSERT INTO app_migrations (name) VALUES ($1)', [name])
          await client.query('COMMIT')
          console.log(`Applied migration ${name}`)
        } catch (error) {
          await client.query('ROLLBACK')
          throw error
        }
      }

      await client.query('SELECT pg_advisory_unlock($1)', [814506243])
    } finally {
      client.release()
    }
  } finally {
    await pool.end()
  }
}

migrate().catch((error) => {
  console.error('Database migration failed:', error.message)
  process.exitCode = 1
})
