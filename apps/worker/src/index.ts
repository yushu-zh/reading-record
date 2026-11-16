import { ApiError, id, missing, router, type ApiContext } from './http';
import { identity, profile, session, updateNickname, updatePassword } from './identity';
import { friend, friendship } from './friendship';
import { reading } from './reading';
import { home } from './home';
import { avatars, updateAvatar } from './avatars';

const loopbackNames = new Set(['localhost','127.0.0.1','[::1]']);

function checkOrigin(c:ApiContext) {
  let configured:URL;
  try { configured = new URL(c.env.ORIGIN); }
  catch { throw new ApiError(503,'origin_configuration','服务地址配置有误，请联系管理员。'); }
  const requested = new URL(c.req.url);
  const actual = c.req.header('Origin');
  const localAlias = c.env.ALLOW_LOOPBACK_ALIAS === 'true' &&
    loopbackNames.has(configured.hostname) && loopbackNames.has(requested.hostname) &&
    requested.protocol === configured.protocol && requested.port === configured.port;
  if (actual === requested.origin && (actual === configured.origin || localAlias)) return;
  throw new ApiError(403,'origin',`请从 ${configured.origin} 打开应用后再提交。当前页面的访问地址与服务配置不匹配。`);
}

const app = router();
app.use('*', async (c,next) => {
  c.header('Cache-Control','no-store');
  c.header('X-Content-Type-Options','nosniff');
  if (!['GET','HEAD','OPTIONS'].includes(c.req.method)) {
    checkOrigin(c);
    if (c.req.header('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
      throw new ApiError(415,'content_type','请使用 JSON 请求。');
    }
  }
  await next();
});
app.onError((error,c) => {
  if (error instanceof ApiError) return c.json({ code:error.code, message:error.message },error.status);
  return c.json({ code:'unavailable',message:'服务暂时不可用，请稍后重试。' },503);
});
app.notFound(c => c.json({ code:'not_found',message:'找不到这项内容。' },404));
const v1 = router();
v1.route('/auth',identity);
v1.get('/me',session(),async c => {
  const db = c.env.DB, user = id(c);
  const [person, relationship] = await Promise.all([profile(db,user),friend(db,user)]);
  if (!person) missing();
  return c.json({ ...person, friend:relationship });
});
v1.patch('/me/nickname',session(),updateNickname);
v1.patch('/me/password',session(),updatePassword);
v1.put('/me/avatar',session(),updateAvatar);
v1.use('/avatars/*',session()).route('/avatars',avatars);
v1.use('/home/*',session()).route('/home',home);
v1.use('/books/*',session()).route('/books',reading);
v1.use('/friendship/*',session()).route('/friendship',friendship);
app.route('/api/v1',v1);
export default app;
