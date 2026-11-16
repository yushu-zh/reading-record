import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

export async function localWorker() {
  const dir = await mkdtemp(join(tmpdir(),'reading-record-'));
  const socket = net.createServer();
  await new Promise((resolve,reject)=>socket.once('error',reject).listen(0,'127.0.0.1',resolve));
  const port = socket.address().port;
  await new Promise(resolve=>socket.close(resolve));
  const origin = 'http://localhost:' + port;
  let worker;
  const close = async () => { await worker?.dispose(); await rm(dir,{recursive:true,force:true}); };
  try {
    execFileSync('node_modules/.bin/wrangler',['deploy','--dry-run','--outdir',dir], {
      env:{ ...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_LOG_PATH:join(dir,'wrangler.log') },
    });
    worker = new Miniflare(convertV4MiniflareOptions({
      port,host:'127.0.0.1',workers:[{ name:'reading-test',modules:true,modulesRoot:dir,scriptPath:join(dir,'index.js'),
      compatibilityDate:'2026-11-15',compatibilityFlags:['nodejs_compat'],bindings:{ORIGIN:origin,ALLOW_LOOPBACK_ALIAS:'true'},d1Databases:{DB:'test'},
      assets:{directory:'./dist', routerConfig:{has_user_worker:true}, run_worker_first:['/api','/api/*'],assetConfig:{not_found_handling:'single-page-application'}},
      }],
    }));
    await worker.ready;
    const db = await worker.getD1Database('DB');
    for (const filename of (await readdir('migrations')).sort()) {
      const sql = await readFile(join('migrations',filename),'utf8');
      const statements = sql.trim().split(/;\n+(?=(?:CREATE|DROP|ALTER)(?:\s|$))/);
      await db.batch(statements.map(statement=>db.prepare(statement)));
    }
    return { db,origin,close, fetch:(path,options)=>worker.dispatchFetch(origin+path,options) };
  } catch (error) { await close(); throw error; }
}
