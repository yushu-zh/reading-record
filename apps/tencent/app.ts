import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Handler } from 'hono';
import type { Database } from './api/database';
import api from './api/index';

export function createTencentApp(database: Database, origin: string, allowLoopbackHttp = false) {
  const app = new Hono();
  const proxy = new URL(origin);
  const localHttp = allowLoopbackHttp && proxy.protocol === 'http:' && proxy.hostname === '127.0.0.1';
  if (proxy.origin !== origin || (proxy.protocol !== 'https:' && !localHttp)) {
    throw new Error('ORIGIN must be the fixed HTTPS origin');
  }
  app.get('/healthz', c => c.text('ok'));
  const handleApi: Handler = c => {
    const request = c.req.raw;
    const url = new URL(request.url);
    if (url.host !== proxy.host) {
      return c.json({code:'origin',message:'访问地址与服务配置不匹配。'},403,{'Cache-Control':'no-store'});
    }
    const canonical = origin + url.pathname + url.search;
    return api.fetch(new Request(canonical, request), {DB:database,ORIGIN:origin});
  };
  app.all('/api',handleApi);
  app.all('/api/*',handleApi);
  app.use('*', async (c,next) => {
    c.header('X-Content-Type-Options','nosniff');
    c.header('Referrer-Policy','no-referrer');
    c.header('X-Frame-Options','DENY');
    c.header('Content-Security-Policy',
      "default-src 'self'; style-src 'self' 'unsafe-inline'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'");
    if (c.req.path === '/sw.js' || c.req.path === '/') c.header('Cache-Control','no-cache');
    await next();
  });
  app.get('*',serveStatic({root:'./dist'}));
  app.get('*',async (c,next) => {
    if (!c.req.header('Accept')?.includes('text/html')) return c.notFound();
    c.header('Cache-Control','no-cache');
    return serveStatic({path:'./dist/index.html'})(c,next);
  });
  return app;
}
