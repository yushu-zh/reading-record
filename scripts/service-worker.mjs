import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = new URL('../dist/',import.meta.url);
const paths = (await readdir(dist,{recursive:true,withFileTypes:true}))
  .filter(entry => entry.isFile() && !entry.name.startsWith('_') && entry.name !== 'sw.js')
  .map(entry => relative(fileURLToPath(dist),join(entry.parentPath,entry.name)))
  .sort();
const hash = createHash('sha256').update(await readFile(new URL(import.meta.url)));
for (const path of paths) hash.update(path).update(await readFile(new URL(path,dist)));
const version = 'reading-shell-' + hash.digest('hex').slice(0,20);

await writeFile(new URL('sw.js',dist),`
const VERSION = ${JSON.stringify(version)};
const SHELL = '/';
const ASSETS = new Set(${JSON.stringify(paths.map(path => path === 'index.html' ? '/' : '/' + path))});
self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll([...ASSETS])));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('reading-shell-') && key !== VERSION) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if (event.data === 'activate') event.waitUntil(self.skipWaiting());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET' || url.pathname === '/api' || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(caches.open(VERSION).then(cache => cache.match(SHELL)).then(response =>
      response && !response.redirected ? response : fetch(event.request)
    ));
  } else if (ASSETS.has(url.pathname)) {
    event.respondWith(caches.open(VERSION).then(cache => cache.match(url.pathname)).then(response => response || fetch(event.request)));
  }
});
`);
