import { ApiError, id, missing, router, type ApiContext } from './http';
import { identity, profile, session, updateNickname, updatePassword } from './identity';
import { friend, friendship } from './friendship';
import { reading } from './reading';
import { home } from './home';
import { avatars, updateAvatar } from './avatars';
import { statistics } from './statistics';

function checkOrigin(c: ApiContext) {
  const configured = c.env.ORIGIN;
  if (c.req.header('Origin') === configured && new URL(c.req.url).origin === configured) return;
  throw new ApiError(403,'origin',`请从 ${configured} 打开应用后再提交。当前页面的访问地址与服务配置不匹配。`);
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
v1.use('/statistics/*',session()).route('/statistics',statistics);
app.route('/api/v1',v1);
export default app;
