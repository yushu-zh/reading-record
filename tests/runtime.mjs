import { serve } from '@hono/node-server';
import { createTencentApp } from '../.tencent-build/app.js';
import { openLocalPostgres } from '../scripts/local-postgres.mjs';

export async function localApp({ listen = false } = {}) {
  const database = await openLocalPostgres();
  const hostname = '127.0.0.1';
  let server;
  try {
    const port = listen ? await new Promise((resolve, reject) => {
      server = serve({ fetch: request => app.fetch(request), hostname, port: 0 }, address => resolve(address.port));
      server.once('error', reject);
    }) : 8787;
    const origin = `http://${hostname}:${port}`;
    const app = createTencentApp(database.db, origin, true);
    return {
      ...database,
      origin,
      async close() {
        if (server) await new Promise(resolve => server.close(resolve));
        await database.close();
      },
      fetch: (path, options) => app.request(origin + path, options),
    };
  } catch (error) {
    server?.close();
    await database.close();
    throw error;
  }
}
