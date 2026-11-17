import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { cloudbaseDatabase } from '../.tencent-build/gateway.js';

const migrations = new URL('../apps/tencent/migrations/', import.meta.url);

export async function openLocalPostgres(dataDir) {
  const sql = new PGlite(dataDir);
  try {
    await sql.transaction(async tx => {
      await tx.exec('CREATE TABLE IF NOT EXISTS public.local_migrations (name text PRIMARY KEY)');
      const { rows } = await tx.query('SELECT name FROM public.local_migrations');
      const applied = new Set(rows.map(row => row.name));
      if (!applied.size) await tx.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role');
      for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
        if (applied.has(name)) continue;
        await tx.exec(await readFile(new URL(name, migrations), 'utf8'));
        await tx.query('INSERT INTO public.local_migrations VALUES ($1)', [name]);
      }
    });
    await sql.exec('SET search_path = reading_record, pg_catalog');
    // Run the deployed gateway function in PostgreSQL without sending network requests.
    const db = cloudbaseDatabase('local', 'local', async (_url, options) => {
      try {
        const { commands } = JSON.parse(options.body);
        const { rows } = await sql.transaction(async tx => {
          await tx.exec('SET LOCAL ROLE service_role');
          return tx.query('SELECT public.reading_record_batch($1::jsonb) AS result', [JSON.stringify(commands)]);
        });
        return Response.json(rows[0].result);
      } catch (error) {
        return Response.json({ message: error.message }, { status: 400 });
      }
    });
    return { sql, db, close: () => sql.close() };
  } catch (error) {
    await sql.close();
    throw error;
  }
}
