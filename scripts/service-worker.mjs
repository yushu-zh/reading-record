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
const shellHash = createHash('sha256').update(await readFile(new URL('index.html',dist))).digest('hex');

await writeFile(new URL('sw.js',dist),`
const VERSION = ${JSON.stringify(version)};
const SHELL = '/';
const SHELL_HASH = ${JSON.stringify(shellHash)};
const ASSETS = new Set(${JSON.stringify(paths.filter(path => path !== 'index.html').map(path => '/' + path))});
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const shell = await fetch(SHELL, {cache:'reload'});
    if (!shell.ok || shell.redirected) throw new Error('The application shell is unavailable');
    // The new worker may arrive before the matching HTML during a rollout.
    const digest = await crypto.subtle.digest('SHA-256', await shell.clone().arrayBuffer());
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,'0')).join('');
    if (hash !== SHELL_HASH) throw new Error('The application shell belongs to a different release');
    const cache = await caches.open(VERSION);
    await cache.addAll(ASSETS);
    await cache.put(SHELL,shell);
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('reading-shell-') && key !== VERSION) await caches.delete(key);
    }
    await self.clients.claim();
  })());
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
