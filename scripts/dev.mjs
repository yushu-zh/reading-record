import { serve } from '@hono/node-server';
import { createTencentApp } from '../.tencent-build/app.js';
import { openLocalPostgres } from './local-postgres.mjs';

const hostname = '127.0.0.1';
const port = 8787;
const origin = `http://${hostname}:${port}`;
const database = await openLocalPostgres('./.local-postgres');
const app = createTencentApp(database.db, origin, true);
const server = serve({ fetch: app.fetch, hostname, port }, () => console.log(origin));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(() => { void database.close(); }));
}
server.on('error', async error => {
  console.error(error.message);
  await database.close();
  process.exitCode = 1;
});
