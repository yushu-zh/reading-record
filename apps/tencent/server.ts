import { serve } from '@hono/node-server';
import { Pool } from 'pg';
import { createTencentApp } from './app';
import { postgresDatabase } from './database';
import { cloudbaseDatabase } from './gateway';

const { CLOUDBASE_ENV_ID, CLOUDBASE_API_KEY, DATABASE_URL, ORIGIN, PORT } = process.env;
if (!ORIGIN) throw new Error('ORIGIN is required');
function database() {
  if (CLOUDBASE_ENV_ID && CLOUDBASE_API_KEY) return cloudbaseDatabase(CLOUDBASE_ENV_ID,CLOUDBASE_API_KEY);
  if (!DATABASE_URL) throw new Error('CloudBase credentials or DATABASE_URL are required');
  const pool = new Pool({
    connectionString: DATABASE_URL,
    onConnect: client => client.query('SET search_path = reading_record, pg_catalog'),
    max: 2,
    idleTimeoutMillis: 1_000,
    connectionTimeoutMillis: 5_000,
  });
  pool.on('error', () => console.error('Idle PostgreSQL connection failed'));
  return postgresDatabase(pool);
}
const app = createTencentApp(database(),ORIGIN);
serve({ fetch:app.fetch, hostname:'0.0.0.0', port:Number(PORT ?? '8080') });
