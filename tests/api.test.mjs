import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { localApp } from './runtime.mjs';

const hash = token => createHash('sha256').update(token).digest('base64url');
let runtime;
const owners = ['alice','bob','carol'];
const code = user => (user + '_'.repeat(22)).slice(0,22);
before(async () => {
  runtime = await localApp();
  for (const u of owners) {
    await runtime.db.batch([
      runtime.db.prepare('INSERT INTO users(id,nickname,avatar,friend_code) VALUES (?,?,0,?)').bind(u,u,code(u)),
      runtime.db.prepare('INSERT INTO password_credentials VALUES (?,?,?,?)').bind(u,u,'unused','unused'),
      runtime.db.prepare("INSERT INTO sessions(digest,user_id,purpose,expires_at,verified_at) VALUES (?,?,'password',floor(extract(epoch FROM statement_timestamp()))::bigint+3600,floor(extract(epoch FROM statement_timestamp()))::bigint)").bind(hash(u),u),
    ]);
  }
});
after(async()=>runtime?.close());

async function api(user,path,method='GET',data={},origin=runtime.origin){
  const response = await runtime.fetch('/api/v1'+path,{
    method, headers:{Origin:origin, Cookie:user ? '__Host-reading-password-session='+user : '', 'Content-Type':'application/json'},
    ...(method==='GET' ? {} : {body:JSON.stringify(data)}),
  });
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  return [response.status,await response.json()];
}
async function request(user,path,method,data,status=200) {
  const [actual,value] = await api(user,path,method,data);
  assert.equal(actual,status,JSON.stringify(value));
  return value;
}

test('API 路由、会话与写入来源',async()=>{
  await request(null,'/books','POST',{title:'无会话'},401);
  const [blocked, error]=await api('alice','/books','POST',{},'https://example.invalid');
  assert.equal(blocked,403);
  assert.ok(error.message.includes(runtime.origin));
  assert.equal((await api('alice','/books','POST',{},runtime.origin.replace('127.0.0.1','localhost')))[0],403);
  await request(null,'/me/avatar','PUT',{jpeg:'not-an-image'},401);
  await request('alice','/me/avatar','PUT',{jpeg:'not-an-image'},422);
  assert.equal((await api(null,'/unknown'))[0],404);
  assert.equal((await runtime.fetch('/')).status,200);
});

test('PostgreSQL 追加打卡、历史投影、编辑和幂等', async () => {
  const create = {title:'三体',totalPages:300,requestId:randomUUID()};
  const [first,second] = await Promise.all([request('alice','/books','POST',create),request('alice','/books','POST',create)]);
  assert.equal(first.id,second.id);
  const book = '/books/'+first.id;
  await request('alice','/books','POST',{...create,title:'另一本'},409);
  const { rows: [{ date: opening }] } = await runtime.sql.query(
    "SELECT to_char(date_trunc('week', business_date()::date) - interval '1 day', 'YYYY-MM-DD') AS date");
  await runtime.sql.transaction(async tx => {
    await tx.exec('ALTER TABLE check_ins DISABLE TRIGGER validate_check_in');
    await tx.query('INSERT INTO check_ins (id,book_id,reading_date,page,expected_revision,sequence,request_id,input_digest) VALUES ($1,$2,$3,100,0,1,$4,$5)',
      [randomUUID(),first.id,opening,randomUUID(),'prior-week']);
    await tx.exec('ALTER TABLE check_ins ENABLE TRIGGER validate_check_in');
  });

  const home = await request('alice','/home');
  assert.equal(home.self.books[0].weekOpeningPage,100);
  const path = book+'/check-ins';
  const base = { expectedDate:home.date,expectedRevision:1,requestId:randomUUID(),page:140 };
  await request('bob',path,'POST',base,404);
  const [a,b] = await Promise.all([request('alice',path,'POST',base),request('alice',path,'POST',base)]);
  assert.equal(a.record.id,b.record.id);
  assert.equal(a.book.currentPage,140);
  await request('alice',path,'POST',{...base,page:130},409);
  const correction = { ...base,expectedRevision:2,requestId:randomUUID(),page:130 };
  assert.equal((await request('alice',path,'POST',correction)).book.currentPage,130);
  const projected = await request('alice','/home');
  assert.deepEqual(projected.self.books[0].days,[{date:home.date,page:130}]);
  await request('alice',path,'POST',{...correction,expectedRevision:3,requestId:randomUUID(),page:99},422);
  await request('alice',path,'POST',{...correction,expectedRevision:3,expectedDate:'2000-01-01',requestId:randomUUID()},409);
  await request('alice',path,'POST',{...correction,requestId:randomUUID()},409);
  assert.equal(await runtime.db.prepare('SELECT count(*)::integer AS n FROM check_ins WHERE book_id=?').bind(first.id).first('n'),3);
  const edited = await request('alice',book,'PATCH',{ title:'三体',totalPages:130,expectedRevision:3 });
  assert.equal(edited.completedOn,home.date);
  await request('alice',book,'PATCH',{ title:'三体',totalPages:129,expectedRevision:4 },422);
  const reopened = await request('alice',path,'POST',{...correction,expectedRevision:4,requestId:randomUUID(),page:120});
  assert.equal(reopened.book.completedOn,null);
  await request('alice',book,'DELETE',{expectedRevision:5});
  assert.equal((await request('alice','/home')).self.books.length,0);
  assert.equal(await runtime.db.prepare('SELECT count(*)::integer AS n FROM check_ins WHERE book_id=?').bind(first.id).first('n'),4);
  assert.equal((await request('alice',path,'POST',base)).record.id,a.record.id);
});

test('并发好友绑定整批回滚，解除只允许原关系成员', async () => {
  const friendBook = await request('bob','/books','POST',{title:'朋友的书',totalPages:500,requestId:randomUUID()});
  assert.ok(friendBook.id);
  await request('alice','/friendship','POST',{code:code('alice')},422);
  const races = await Promise.all([api('alice','/friendship','POST',{code:code('bob')}),api('carol','/friendship','POST',{code:code('bob')})]);
  assert.deepEqual(races.map(([status])=>status).sort(),[200,409]);
  const winner = races[0][0]===200 ? 'alice' : 'carol';
  const loser = winner==='alice' ? 'carol' : 'alice';
  const home = await request(winner,'/home');
  assert.equal(home.friend.books[0].id,friendBook.id);
  assert.equal((await request(loser,'/home')).friend,null);
  assert.equal(await runtime.db.prepare('SELECT count(*)::integer AS n FROM friendships').first('n'),1);
  assert.equal((await request(winner,'/friendship','POST',{code:code('bob')})).relationshipId,home.relationshipId);
  const path = '/friendship/'+home.relationshipId;
  await request(loser,path,'DELETE',{},404);
  await request('bob',path,'DELETE');
  await request(winner,path,'DELETE');
  assert.equal((await request(winner,'/home')).friend,null);
  assert.equal((await request('bob','/home')).friend,null);
});

test('昵称注册唯一，重复请求回滚建号，错误密码受限流保护',async()=>{
  const input={nickname:'  Ｍｉｎｇ  ',password:'my secure reading password'};
  const [first,second]=await Promise.all([
    api(null,'/auth/register','POST',input),
    api(null,'/auth/register','POST',{...input,nickname:'ming'}),
  ]);
  assert.deepEqual([first[0],second[0]].sort(),[200,409]);
  assert.equal(await runtime.db.prepare("SELECT count(*)::integer AS n FROM users WHERE lower(nickname)='ming'").first('n'),1);
  const credential=await runtime.db.prepare("SELECT salt,password_hash FROM password_credentials WHERE nickname_key='ming'").first();
  assert.notEqual(credential.password_hash,input.password);
  assert.ok(credential.salt);
  await request(null,'/auth/login','POST',{...input,nickname:'MING'});
  await request(null,'/auth/login','POST',{...input,password:'incorrect password input'},401);
  const scope='password:login:account:'+hash('ming');
  await runtime.db.prepare('INSERT INTO auth_attempts VALUES (?,floor(extract(epoch FROM statement_timestamp()))::bigint/300,10),(?,floor(extract(epoch FROM statement_timestamp()))::bigint/300+1,10) ON CONFLICT (scope,"window") DO UPDATE SET attempts=excluded.attempts')
    .bind(scope,scope).run();
  await request(null,'/auth/login','POST',input,429);
});

test('旧账号的会话和好友邀请码在切换后不可用',async()=>{
  const oldCode='legacy________________';
  await runtime.db.batch([
    runtime.db.prepare("INSERT INTO users(id,nickname,avatar,friend_code) VALUES ('legacy','旧用户',0,?)").bind(oldCode),
    runtime.db.prepare("INSERT INTO sessions(digest,user_id,purpose,expires_at,verified_at) VALUES (?,'legacy','full',floor(extract(epoch FROM statement_timestamp()))::bigint+3600,floor(extract(epoch FROM statement_timestamp()))::bigint)")
      .bind(hash('legacy')),
  ]);
  await request('legacy','/me','GET',{},401);
  await request('alice','/friendship','POST',{code:oldCode},422);
  await request(null,'/auth/login','POST',{nickname:'旧用户',password:'my secure reading password'},401);
});

test('密码超出旧字符上限时仍可注册和登录',async()=>{
  const input={nickname:'长密码读者',password:'阅读'.repeat(300)};
  await request(null,'/auth/register','POST',input);
  await request(null,'/auth/login','POST',input);
});


test('初始已读作为灰色历史和累计下限，同一请求不得变更初始页数',async()=>{
  const create={title:'读到一半',totalPages:300,initialPage:80,requestId:randomUUID()};
  await request('alice','/books','POST',{...create,initialPage:301},422);
  const book=await request('alice','/books','POST',create);
  assert.equal(book.currentPage,80);
  await request('alice','/books','POST',{...create,initialPage:90},409);
  const home=await request('alice','/home');
  const progress=home.self.books.find(item=>item.id===book.id);
  assert.equal(progress.weekOpeningPage,80);
  assert.equal(progress.beforeToday,80);
  assert.deepEqual(progress.days,[]);
  const path='/books/'+book.id;
  await request('alice',path,'PATCH',{title:book.title,totalPages:79,expectedRevision:0},422);
  const check={expectedDate:home.date,expectedRevision:0,requestId:randomUUID()};
  await request('alice',path+'/check-ins','POST',{...check,page:79},422);
  await request('alice',path+'/check-ins','POST',{...check,page:120});
  const done=await request('alice','/books','POST',{...create,title:'已经读完',initialPage:300,requestId:randomUUID()});
  assert.equal(done.completedOn,home.date);
});

test('已移除忘记密码接口',async()=>{
  await request(null,'/auth/recovery','POST',{code:'invalid',password:'test'},404);
});

test('并发修改密码只签发一个新会话',async()=>{
  const payload={nickname:'改密读者',password:'old secret'};
  const auth=async(path,method,data,cookie)=>runtime.fetch('/api/v1'+path,{
    method,headers:{Origin:runtime.origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},
    body:JSON.stringify(data),
  });
  const register=await auth('/auth/register','POST',payload);
  const login=await auth('/auth/login','POST',payload);
  assert.equal(register.status,200);
  assert.equal(login.status,200);
  const {userId}=await register.json();
  const changes=await Promise.all([register,login].map((response,index)=>{
    const cookie=response.headers.get('Set-Cookie').split(';')[0];
    return auth('/me/password','PATCH',{currentPassword:payload.password,newPassword:'new secret '+index},cookie);
  }));
  assert.equal(changes.filter(response=>response.status===200).length,1);
  assert.equal(await runtime.db.prepare('SELECT count(*)::integer AS n FROM sessions WHERE user_id=? AND revoked_at IS NULL')
    .bind(userId).first('n'),1);
});
