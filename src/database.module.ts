import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type DrizzleDb = NodePgDatabase<typeof schema>;

export const DRIZZLE = Symbol('DRIZZLE');

function createPool(config: ConfigService): Pool {
  const url = config.get<string>('DATABASE_URL');
  if (!url) {
    throw new Error('DATABASE_URL is not set — check erpnestbackend/.env');
  }

  return new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_TIMEOUT_MS ?? 30_000),
    keepAlive: true,
  });
}

@Global()
@Module({
  providers: [
    {
      provide: Pool,
      useFactory: (config: ConfigService) => createPool(config),
      inject: [ConfigService],
    },
    {
      provide: DRIZZLE,
      useFactory: (pool: Pool) => drizzle(pool, { schema }),
      inject: [Pool],
    },
  ],
  exports: [Pool, DRIZZLE],
})
export class DatabaseModule {}
