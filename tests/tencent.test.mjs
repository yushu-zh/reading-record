import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {createTencentApp} from '../.tencent-build/app.js';
import {cloudbaseDatabase} from '../.tencent-build/gateway.js';

test('腾讯云入口在 PostgreSQL 上登录、绑定和打卡', async () => {
  const sql = new PGlite();
  try {
    await sql.transaction(async transaction => {
      await transaction.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role');
      for (const name of ['0001_reading_record.sql','0002_reading_projections.sql','0003_cloudbase_gateway.sql']) {
        await transaction.exec(await readFile(new URL('../apps/tencent/migrations/'+name,import.meta.url),'utf8'));
      }
    });
    await sql.exec('SET ROLE anon');
    await assert.rejects(sql.query("SELECT public.reading_record_batch('[]')"),/permission denied/);
    await sql.exec('SET ROLE service_role');
    await sql.exec(`SET "request.jwt.claims" = '{"role":"service_role"}'`);
    const db = cloudbaseDatabase('test-env','test-key',async (_url,options)=>{
      try {
        assert.equal(options.headers.Authorization,'Bearer test-key');
        const {commands}=JSON.parse(options.body);
        const {rows:[row]}=await sql.query('SELECT public.reading_record_batch($1::jsonb) AS result',[JSON.stringify(commands)]);
        return Response.json(row.result);
      } catch (error) {
        return Response.json({message:error.message},{status:400});
      }
    });
    const origin = 'https://reading.example.test';
    const app = createTencentApp(db,origin);
    const appPage = await app.request(origin+'/');
    assert.equal(appPage.status,200);
    assert.match(await appPage.text(),/阅读打卡/);
    assert.equal((await app.request(origin+'/api')).status,404);

    async function request(path, {method='GET', input, cookie, requestOrigin=origin, status=200} = {}) {
      const headers = {Origin:requestOrigin,'Content-Type':'application/json'};
      if (cookie) headers.Cookie=cookie;
      const response = await app.request(origin+'/api/v1'+path,{method,headers,body:JSON.stringify(input)});
      const data = await response.json();
      assert.equal(response.status,status,JSON.stringify(data));
      assert.equal(response.headers.get('cache-control'),'no-store');
      return {data,cookie:response.headers.get('set-cookie')?.split(';')[0]};
    }

    const password = 'test-reading-password';
    const alice = await request('/auth/register',{method:'POST',input:{nickname:'读者甲',password}});
    const bob = await request('/auth/register',{method:'POST',input:{nickname:'读者乙',password}});
    const login = await request('/auth/login',{method:'POST',input:{nickname:'读者甲',password}});
    await request('/books',{method:'POST',cookie:login.cookie,input:{},requestOrigin:'https://other.example.test',status:403});
    const profile = await request('/me',{cookie:bob.cookie});
    await request('/friendship',{method:'POST',cookie:login.cookie,input:{code:profile.data.friendCode}});
    const {data:book} = await request('/books',{method:'POST',cookie:bob.cookie,
      input:{title:'三体',totalPages:100,initialPage:10,requestId:randomUUID()}});
    const {data:before} = await request('/home',{cookie:login.cookie});
    assert.equal(before.friend.books[0].weekOpeningPage,10);
    const checkIn = {expectedDate:before.date,expectedRevision:0,page:20,requestId:randomUUID()};
    const route = '/books/'+book.id+'/check-ins';
    const {data:first} = await request(route,{method:'POST',cookie:bob.cookie,input:checkIn});
    const {data:replayed} = await request(route,{method:'POST',cookie:bob.cookie,input:checkIn});
    assert.equal(replayed.record.id,first.record.id);
    const {data:after} = await request('/home',{cookie:login.cookie});
    assert.deepEqual(after.friend.books[0].days,[{date:before.date,page:20}]);
    await request('/me/password',{method:'PATCH',cookie:login.cookie,input:{currentPassword:password,newPassword:'new-reading-password'}});
    await request('/me',{cookie:alice.cookie,status:401});
  } finally {
    await sql.close();
  }
});
