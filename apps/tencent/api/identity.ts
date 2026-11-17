import { scryptSync, timingSafeEqual } from 'node:crypto';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { Profile } from '../../../packages/contracts';
import { unixNow, type Database } from './database';
import { ApiError, body, conflict, decode, digest, encode, id, invalid, router, secret, type ApiContext, type Env } from './http';

const sessionCookie = '__Host-reading-password-session';
const cookie = { path:'/', secure:true, httpOnly:true, sameSite:'Lax' } as const;
const sessionLifetime = 30 * 86400;
type Credential = { user_id:string; salt:string; password_hash:string };
const credentialFields = 'p.user_id,p.salt,p.password_hash';
const activeSession =
  `EXISTS (SELECT 1 FROM sessions WHERE digest=? AND user_id=? AND revoked_at IS NULL AND expires_at>${unixNow})`;
const activeCredential = 'EXISTS (SELECT 1 FROM password_credentials WHERE user_id=? AND password_hash=?)';

function unauthorized(): never {
  throw new ApiError(401,'authentication_required','请使用昵称和密码登录。');
}
function rejected(): never {
  throw new ApiError(401,'invalid_credentials','昵称或密码有误。');
}
export function session() {
  return createMiddleware<Env>(async (c,next) => {
    const token = getCookie(c,sessionCookie);
    if (!token) unauthorized();
    const row = await c.env.DB.prepare(`SELECT digest,user_id AS "userId" FROM sessions
      WHERE digest=? AND purpose='password' AND revoked_at IS NULL AND expires_at>${unixNow}`)
      .bind(await digest(token)).first<Env['Variables']['session']>();
    if (!row) unauthorized();
    c.set('session',row);
    await next();
  });
}
export const avatarVersionSql = (user:string) => `(SELECT version FROM profile_avatars WHERE user_id=${user})`;
export const profileColumns = `u.id, u.nickname, u.avatar, ${avatarVersionSql('u.id')} AS "avatarVersion"`;
export function profile(db: Database, userId: string) {
  return db.prepare(`SELECT ${profileColumns},u.friend_code AS "friendCode" FROM users u WHERE u.id=?`)
    .bind(userId).first<Profile & {friendCode:string}>();
}
export function resolveFriendCode(db: Database, code: string) {
  return db.prepare('SELECT u.id FROM users u JOIN password_credentials p ON p.user_id=u.id WHERE u.friend_code=?')
    .bind(code).first<string>('id');
}

async function limit(c: ApiContext, action: string, account?: string) {
  const db = c.env.DB;
  const unix = unixNow;
  const sharedSource = await digest('local');
  const increment = (scope:string,max:number) => db.prepare(`INSERT INTO auth_attempts VALUES (?,${unix}/300,1)
    ON CONFLICT(scope,"window") DO UPDATE SET attempts=auth_attempts.attempts+1 WHERE auth_attempts.attempts<? RETURNING attempts`).bind(scope,max);
  const attempts = [increment(`password:${action}:ip:${sharedSource}`,action==='register' ? 10 : 30)];
  if (account) attempts.push(increment(`password:${action}:account:${await digest(account)}`,10));
  if ((await db.batch(attempts)).some(result=>!result.results.length)) {
    throw new ApiError(429,'rate_limit','尝试次数过多，请稍后再试。');
  }
  if (Math.random()<0.05) {
    void db.batch([
      db.prepare(`DELETE FROM auth_attempts WHERE (scope,"window") IN (
        SELECT scope,"window" FROM auth_attempts WHERE "window"<${unix}/300-2 LIMIT 100)`),
      db.prepare(`DELETE FROM sessions WHERE digest IN (SELECT digest FROM sessions WHERE expires_at<=${unix} LIMIT 100)`),
    ]).catch(() => undefined);
  }
}

function nicknameInput(value: unknown) {
  if (typeof value!=='string' || value.length>100) invalid('请输入 1 至 24 个字符的昵称。');
  const nickname=value.trim().normalize('NFKC');
  if (!nickname || [...nickname].length>24 || /[\p{Cc}\p{Cf}]/u.test(nickname)) invalid('请输入 1 至 24 个字符的昵称。');
  return {nickname,key:nickname.toLowerCase()};
}
function passwordInput(value: unknown) {
  if (typeof value!=='string' || !value) invalid('请输入密码。');
  return value;
}
function derivePassword(password:string,salt:string) {
  return scryptSync(password,decode(salt),32,{N:16384,r:8,p:5});
}
function newPassword(password:string) {
  const salt=secret(16);
  return {salt,hash:encode(derivePassword(password,salt))};
}
const dummySalt='AAAAAAAAAAAAAAAAAAAAAA';
const dummyHash=new Uint8Array(32);
function matchesPassword(password:string,credential:Credential|null) {
  const actual=derivePassword(password,credential?.salt ?? dummySalt);
  const expected=credential ? decode(credential.password_hash) : dummyHash;
  return timingSafeEqual(actual,expected) && credential!==null;
}
function signIn(c:ApiContext,token:string) {
  setCookie(c,sessionCookie,token,{...cookie,maxAge:sessionLifetime});
}
function insertSession(db:Database,token:string,userId:string) {
  const unix=unixNow;
  return db.prepare(`INSERT INTO sessions(digest,user_id,purpose,expires_at,verified_at)
    VALUES (?,?,'password',${unix}+?,${unix})`).bind(token,userId,sessionLifetime);
}

export const identity=router();
identity.post('/register',async c=>{
  const input=await body(c);
  const {nickname,key}=nicknameInput(input.nickname), password=passwordInput(input.password);
  await limit(c,'register');
  const db=c.env.DB,userId=crypto.randomUUID(), token=secret();
  const {salt,hash}=newPassword(password);
  try {
    await db.batch([
      db.prepare('INSERT INTO users(id,nickname,avatar,friend_code) VALUES (?,?,?,?)').bind(userId,nickname,0,secret(16)),
      db.prepare('INSERT INTO password_credentials VALUES (?,?,?,?)').bind(userId,key,salt,hash),
      insertSession(db,await digest(token),userId),
    ]);
  } catch (error) {
    if (String(error).includes('password_credentials.nickname_key')) conflict('nickname_taken','该昵称已被使用，请换一个。');
    throw error;
  }
  signIn(c,token);
  return c.json({userId});
});
identity.post('/login',async c=>{
  const input=await body(c);
  const {key}=nicknameInput(input.nickname),password=passwordInput(input.password);
  await limit(c,'login',key);
  const db=c.env.DB;
  const current=await db.prepare(`SELECT ${credentialFields} FROM password_credentials p WHERE p.nickname_key=?`).bind(key).first<Credential>();
  if (!matchesPassword(password,current) || !current) rejected();
  const token=secret();
  const unix=unixNow;
  const result=await db.prepare(`INSERT INTO sessions(digest,user_id,purpose,expires_at,verified_at)
    SELECT ?,?,'password',${unix}+?,${unix} WHERE EXISTS (SELECT 1 FROM password_credentials WHERE user_id=? AND password_hash=? AND nickname_key=?)`)
    .bind(await digest(token),current.user_id,sessionLifetime,current.user_id,current.password_hash,key).run();
  if (!result.meta.changes) rejected();
  signIn(c,token);
  return c.json({userId:current.user_id});
});
export async function updateNickname(c:ApiContext) {
  const {nickname,key}=nicknameInput((await body(c)).nickname);
  const userId=id(c), db=c.env.DB;
  const guard=[c.get('session').digest,userId];
  try {
    const [updated]=await db.batch([
      db.prepare(`UPDATE password_credentials SET nickname_key=? WHERE user_id=? AND ${activeSession}`)
        .bind(key,userId,...guard),
      db.prepare(`UPDATE users SET nickname=? WHERE id=? AND ${activeSession} AND EXISTS (
        SELECT 1 FROM password_credentials WHERE user_id=? AND nickname_key=?
      )`).bind(nickname,userId,...guard,userId,key),
    ]);
    if (!updated.meta.changes) unauthorized();
  } catch (error) {
    if (String(error).includes('password_credentials.nickname_key')) conflict('nickname_taken','该昵称已被使用，请换一个。');
    throw error;
  }
  return c.json({nickname});
}

export async function updatePassword(c:ApiContext) {
  const input=await body(c);
  const password=passwordInput(input.currentPassword), next=passwordInput(input.newPassword);
  const userId=id(c), db=c.env.DB, oldSession=c.get('session').digest;
  const unix=unixNow;
  await limit(c,'change',userId);
  const current=await db.prepare(`SELECT ${credentialFields} FROM password_credentials p WHERE p.user_id=?`).bind(userId).first<Credential>();
  if (!current || !matchesPassword(password,current)) invalid('当前密码有误。');
  const token=secret();
  const {salt,hash}=newPassword(next);
  const [updated]=await db.batch([
    db.prepare(`UPDATE password_credentials SET salt=?,password_hash=? WHERE user_id=? AND password_hash=? AND ${activeSession}`)
      .bind(salt,hash,userId,current.password_hash,oldSession,userId),
    db.prepare(`UPDATE sessions SET revoked_at=${unix} WHERE user_id=? AND revoked_at IS NULL AND ${activeCredential}`)
      .bind(userId,userId,hash),
    db.prepare(`INSERT INTO sessions(digest,user_id,purpose,expires_at,verified_at)
      SELECT ?,?,'password',${unix}+?,${unix} WHERE ${activeCredential}`)
      .bind(await digest(token),userId,sessionLifetime,userId,hash),
  ]);
  if (!updated.meta.changes) conflict('credential_changed','登录状态已更新，请重新登录后再试。');
  signIn(c,token);
  return c.json({ok:true});
}
identity.delete('/session',async c=>{
  const token=getCookie(c,sessionCookie);
  if (token) await c.env.DB.prepare(`UPDATE sessions SET revoked_at=${unixNow} WHERE digest=? AND revoked_at IS NULL`).bind(await digest(token)).run();
  deleteCookie(c,sessionCookie,cookie);
  return c.json({ok:true});
});
