import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { chromium, devices } from 'playwright';
import { localApp } from './runtime.mjs';

let runtime,browser;
const password = 'correct-horse-reading-42';
const newPassword = 'different-shelf-password-83';
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const button = (page,name)=>page.getByRole('button',{name,exact:true});
const shelf = (page,name)=>page.getByRole('region',{name,exact:true});
const dialog = page=>page.getByRole('dialog');
before(async()=>{
  runtime=await localApp({listen:true});
  const executablePath=process.env.READING_TEST_CHROME || (existsSync(chrome) ? chrome : undefined);
  browser=await chromium.launch({executablePath});
});
after(async()=>{await browser?.close();await runtime?.close();});

async function reader() {
  const context=await browser.newContext({...devices['Desktop Chrome'],viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage();
  page.setDefaultTimeout(6500);
  const cdp=await context.newCDPSession(page);
  await page.goto(runtime.origin);
  await button(page,'登录').waitFor();
  return { context,page,cdp };
}
async function swipe(cdp,region) {
  const box = await region.boundingBox();
  const x = Math.round(box.x+box.width*.76), y=Math.round(box.y+120);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-35,y}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-70,y}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
}
async function register(page,nickname,secret=password) {
  await button(page,'注册账号').click();
  await page.getByLabel('昵称').fill(nickname);
  const field=page.getByLabel('密码',{exact:true});
  assert.equal(await button(page,'显示密码').count(),0);
  await field.pressSequentially(secret);
  assert.equal(await field.getAttribute('type'),'password');
  assert.equal(await button(page,'显示密码').count(),1);
  if (process.env.READING_TEST_PASSWORD_SCREENSHOT && nickname==='阿青') {
    await page.screenshot({path:process.env.READING_TEST_PASSWORD_SCREENSHOT});
  }
  await button(page,'显示密码').click();
  assert.equal(await field.getAttribute('type'),'text');
  assert.equal(await field.inputValue(),secret);
  await button(page,'隐藏密码').click();
  assert.equal(await field.getAttribute('type'),'password');
  assert.equal(await page.getByRole('button',{name:/选择头像/}).count(),0);
  await button(page,'注册').click();
  await shelf(page,'我').waitFor();
}
async function createBook(page,title,total,initial=0) {
  await button(page,'新建书籍').click();
  await page.getByLabel('书名').fill(title);
  await page.getByLabel('总页数').fill(String(total));
  await page.getByLabel('已读页数').fill(String(initial));
  await button(page,'保存书籍').click();
  await shelf(page,'我').getByRole('heading',{name:title}).waitFor();
}

test('登录输入框聚焦时保留圆角',async()=>{
  const {context,page}=await reader();
  try {
    const nickname=page.getByLabel('昵称');
    const passwordField=page.getByLabel('密码',{exact:true});
    const borderRadius=field=>field.evaluate(async element=>{
      await Promise.all(element.getAnimations().map(animation=>animation.finished));
      return getComputedStyle(element).borderRadius;
    });
    const nicknameRadius=await borderRadius(nickname);
    const passwordRadius=await borderRadius(passwordField);
    await nickname.click();
    assert.equal(await borderRadius(nickname),nicknameRadius);
    await page.keyboard.press('Tab');
    assert.equal(await passwordField.evaluate(element=>element.matches(':focus-visible')),true);
    assert.equal(await borderRadius(passwordField),passwordRadius);
  } finally { await context.close(); }
});

test('两位读者以密码注册、绑定后直接比较，断网后手动提交', {timeout:65000}, async()=>{
  const alice=await reader(), bob=await reader();
  try {
    await register(alice.page,'阿青');
    await register(bob.page,'小森','x');
    assert.equal(await shelf(alice.page,'我').locator('.avatar-placeholder').count(),1);
    assert.equal(await shelf(alice.page,'朋友').locator('.avatar-placeholder').count(),1);
    await button(alice.page,'我的').click();
    await alice.page.locator('.person').getByRole('button',{name:'上传头像'}).click();
    await alice.page.getByLabel('选择图片').setInputFiles('apps/web/public/icons/icon-512.png');
    await button(alice.page,'保存头像').click();
    await dialog(alice.page).waitFor({state:'hidden'});
    await button(alice.page,'首页').click();
    const photo=shelf(alice.page,'我').locator('img[src*="/api/v1/avatars/"]');
    await photo.waitFor();
    await alice.page.waitForFunction(()=>document.querySelector('img[src*="/api/v1/avatars/"]')?.naturalWidth===256);
    const photoPath=await photo.getAttribute('src');
    const bobOrigin=runtime.origin;
    assert.equal((await bob.page.request.get(bobOrigin+photoPath)).status(),404);
    await createBook(alice.page,'三体',300,80);
    const card = shelf(alice.page,'我');
    await card.getByText('80',{exact:true}).waitFor();
    assert.equal(await card.locator('.segment').count(),0);
    const bounds=await card.boundingBox(), track=await card.locator('.track').boundingBox();
    assert.ok(Math.abs(bounds.x+bounds.width/2-track.x-track.width/2)<1);
    await createBook(bob.page,'人类简史',500);
    await button(alice.page,'邀请好友').click();
    const invite=await dialog(alice.page).locator('code').textContent();
    await button(alice.page,'关闭').click();
    await button(bob.page,'邀请好友').click();
    await bob.page.getByLabel('对方的好友邀请码').fill(invite);
    await button(bob.page,'绑定好友').click();
    await dialog(bob.page).waitFor({state:'hidden'});
    await shelf(bob.page,'朋友').getByRole('heading',{name:'三体'}).waitFor();
    await shelf(bob.page,'朋友').getByRole('heading',{name:'阿青'}).waitFor();
    await shelf(bob.page,'我').getByRole('heading',{name:'小森'}).waitFor();
    await shelf(bob.page,'朋友').locator('img[src*="/api/v1/avatars/"]').waitFor();
    assert.equal((await bob.page.request.get(bobOrigin+photoPath)).headers()['content-type'],'image/jpeg');
    await button(alice.page,'记录阅读页码').click();
    await alice.page.getByLabel('累计页码').fill('130');
    await alice.context.setOffline(true);
    await button(alice.page,'提交打卡').click();
    await alice.page.getByRole('alert').getByText('暂时无法连接，请恢复网络后手动重试。').waitFor();
    await button(alice.page,'关闭').click();
    await button(alice.page,'继续打卡草稿').click();
    assert.equal(await alice.page.getByLabel('累计页码').inputValue(),'130');
    await alice.context.setOffline(false);
    await button(alice.page,'提交打卡').waitFor();
    assert.equal(await runtime.db.prepare('SELECT count(*)::integer AS n FROM check_ins').first('n'),0);
    await button(alice.page,'提交打卡').click();
    await dialog(alice.page).waitFor({state:'hidden'});
    await shelf(alice.page,'我').getByText('130',{exact:true}).waitFor();
    assert.equal(await alice.page.getByText('打卡已记录。',{exact:true}).count(),0);
    assert.equal(await button(alice.page,'更正今天').count(),0);
    await shelf(bob.page,'朋友').getByText('130',{exact:true}).waitFor({timeout:22000});
    const bfr=shelf(bob.page,'朋友');
    assert.equal(await bfr.getByRole('button',{name:'记录阅读页码'}).count(),0);
    const marker=await bfr.getByText('130',{exact:true}).boundingBox(), segment=await bfr.locator('.segment').boundingBox();
    assert.ok(Math.abs(marker.y+marker.height/2-segment.y-segment.height)<1);
    await swipe(alice.cdp,shelf(alice.page,'我'));
    await createBook(alice.page,'活着',250);
    await shelf(alice.page,'朋友').getByRole('heading',{name:'人类简史'}).waitFor();
    await button(alice.page,'我的上一本书').click();
    await shelf(alice.page,'我').getByRole('heading',{name:'三体'}).waitFor();
    const artifact=process.env.READING_TEST_SCREENSHOT;
    if (artifact) await alice.page.screenshot({path:artifact,fullPage:true});
    const precache=await alice.page.evaluate(async()=>{
      await navigator.serviceWorker.ready;
      const keys=await caches.keys();
      const cache=await caches.open(keys.find(key=>key.startsWith('reading-shell-')));
      return (await cache.keys()).map(request=>new URL(request.url).pathname);
    });
    assert.ok(precache.some(path=>path==='/'));
    assert.ok(precache.every(path=>!path.startsWith('/api')));
    await button(alice.page,'我的下一本书').click();
    const progress = shelf(alice.page,'我').locator('.progress-scale');
    await progress.and(alice.page.getByLabel('已读 0 / 250 页')).waitFor();
    assert.equal((await progress.boundingBox()).height,track.height);
    await button(alice.page,'记录阅读页码').click();
    await alice.page.getByLabel('累计页码').fill('249');
    await button(alice.page,'提交打卡').click();
    await progress.and(alice.page.getByLabel('已读 249 / 250 页')).waitFor();
    assert.equal((await progress.boundingBox()).height,track.height);
    assert.equal(await button(alice.page,'定位进度').count(),0);
    await button(alice.page,'记录阅读页码').click();
    await alice.page.getByLabel('累计页码').fill('250');
    await button(alice.page,'提交打卡').click();
    await dialog(alice.page).waitFor({state:'hidden'});
    await shelf(alice.page,'我').locator('.progress-scale[aria-label="已读 250 / 250 页"]').waitFor();
    assert.equal((await progress.boundingBox()).height,track.height);
    await button(alice.page,'记录阅读页码').click();
    await dialog(alice.page).getByRole('heading',{name:'阅读打卡'}).waitFor();
    await button(alice.page,'关闭').click();
    await button(alice.page,'统计').click();
    await alice.page.getByRole('heading',{name:'正在阅读'}).waitFor();
    await alice.page.getByRole('heading',{name:'已读完'}).waitFor();
    await alice.page.locator('.bar-value').getByText('300',{exact:true}).waitFor();
    await button(alice.page,'月').click();
    await alice.page.locator('.bar-value').getByText('300',{exact:true}).waitFor();
    await alice.page.getByRole('button',{name:/活着/}).click();
    await alice.page.locator('.line-chart').waitFor();
    await button(bob.page,'我的').click();
    const settings=bob.page.getByRole('list',{name:'账号与应用'});
    assert.equal(await settings.getByRole('listitem').count(),4);
    await settings.getByText('添加到主屏幕',{exact:true}).click();
    await settings.getByText(/在 Android Chrome 中打开菜单/).waitFor();
    await settings.getByText('添加到主屏幕',{exact:true}).click();
    await settings.getByRole('button',{name:'好友管理'}).click();
    await button(bob.page,'解除好友关系').click();
    await button(bob.page,'确认解除').click();
    await button(bob.page,'绑定好友').waitFor();
    assert.equal((await bob.page.request.get(bobOrigin+photoPath)).status(),404);
    await button(bob.page,'关闭').click();
    await button(bob.page,'首页').click();
    await button(bob.page,'邀请好友').waitFor();
    await button(alice.page,'我的').click();
    await button(alice.page,'退出登录').click();
    await button(alice.page,'登录').waitFor();
    await alice.page.getByLabel('昵称').fill('阿青');
    await alice.page.getByLabel('密码',{exact:true}).fill(password);
    await button(alice.page,'登录').click();
    await shelf(alice.page,'我').getByRole('heading',{name:'三体'}).waitFor();
  } finally { await alice.context.close(); await bob.context.close(); }
});

test('阅读量按日和月分别用当前最大值缩放柱高', async()=>{
  const {context,page}=await reader();
  try {
    await page.clock.setFixedTime(new Date('2026-02-01T18:00:00Z'));
    const dailyTotals=[
      {date:'2026-01-31',pages:100},
      {date:'2026-02-01',pages:20},
    ];
    await page.route('**/api/v1/statistics',route=>route.fulfill({
      json:{reading:[],completed:[],dailyTotals},
    }));
    await register(page,'柱形图读者');

    const chart=page.locator('.chart-panel');
    const bars=chart.locator('.bar');
    async function assertHeight(pages, fraction) {
      const bar=chart.getByTitle(`${pages} 页`,{exact:true});
      const {height, availableHeight}=await bar.evaluate(element=>({
        height:element.getBoundingClientRect().height,
        availableHeight:element.parentElement.getBoundingClientRect().height,
      }));
      assert.ok(availableHeight>0);
      assert.ok(Math.abs(height-availableHeight*fraction)<0.1, `${pages} 页柱高为 ${height}/${availableHeight}`);
    }

    await button(page,'统计').click();
    await chart.getByTitle('100 页',{exact:true}).waitFor();
    assert.equal(await button(page,'日').getAttribute('aria-pressed'),'true');
    assert.equal(await button(page,'周').count(),0);
    assert.equal(await button(page,'年').count(),0);
    assert.equal(await bars.count(),30);
    await assertHeight(100,1);
    await assertHeight(20,0.2);
    assert.equal(await chart.getByTitle('0 页',{exact:true}).first().isVisible(),false);

    dailyTotals.push({date:'2026-02-02',pages:200});
    await page.reload();
    await button(page,'统计').click();
    await chart.getByTitle('200 页',{exact:true}).waitFor();
    await assertHeight(200,1);
    await assertHeight(100,0.5);
    await assertHeight(20,0.1);

    await button(page,'月').click();
    assert.equal(await bars.count(),12);
    const months=Array.from({length:12},(_,index)=>`${index+1}月`);
    assert.deepEqual(await chart.locator('.bar-label').allTextContents(),months);
    await assertHeight(220,1);
    await assertHeight(100,100/220);

    const year=page.getByRole('combobox',{name:'统计年份'});
    await page.clock.setFixedTime(new Date('2026-12-31T15:59:59Z'));
    await button(page,'日').click();
    assert.equal(await year.count(),0);
    await button(page,'月').click();
    assert.deepEqual(await year.getByRole('option').allTextContents(),['2026年']);

    await page.clock.setFixedTime(new Date('2026-12-31T16:00:00Z'));
    await page.reload();
    await button(page,'统计').click();
    await button(page,'月').click();
    assert.deepEqual(await year.getByRole('option').allTextContents(),['2027年','2026年']);
    assert.equal(await year.inputValue(),'2027');
    assert.deepEqual(await chart.locator('.bar-label').allTextContents(),months);
    assert.equal(await chart.getByText('暂无阅读数据').isVisible(),true);
    await year.selectOption('2026');
    await assertHeight(220,1);
    await assertHeight(100,100/220);
    await year.selectOption('2027');
    assert.equal(await chart.getByTitle('220 页',{exact:true}).count(),0);
  } finally { await context.close(); }
});

test('个人面板进入详情，修改昵称和密码后以新凭据登录', {timeout:30000}, async()=>{
  const original=await reader(), other=await reader();
  try {
    assert.equal(await button(original.page,'忘记密码').count(),0);
    await register(original.page,'资料读者');
    const loggedIn=await other.page.evaluate(async password=>{
      const response=await fetch('/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({nickname:'资料读者',password})});
      return response.status;
    },password);
    assert.equal(loggedIn,200);
    await button(original.page,'我的').click();
    await button(original.page,'编辑个人资料').click();
    await original.page.getByRole('heading',{name:'个人资料'}).waitFor();
    await original.page.getByLabel('昵称').fill('新昵称');
    await button(original.page,'保存昵称').click();
    await original.page.getByText('昵称已更新。').waitFor();
    await original.page.getByLabel('当前密码',{exact:true}).fill('wrong');
    await original.page.getByLabel('新密码',{exact:true}).fill(newPassword);
    await button(original.page,'保存密码').click();
    await original.page.getByText('当前密码有误。').waitFor();
    await original.page.getByLabel('当前密码',{exact:true}).fill(password);
    await button(original.page,'保存密码').click();
    await original.page.getByText('密码已更新。').waitFor();
    assert.equal(await other.page.evaluate(async()=> (await fetch('/api/v1/me')).status),401);
    assert.equal(await original.page.evaluate(async()=> (await fetch('/api/v1/me')).status),200);
    await button(original.page,'返回我的').click();
    await original.page.getByRole('heading',{name:'新昵称'}).waitFor();
    await button(original.page,'退出登录').click();
    await button(original.page,'登录').waitFor();
    await original.page.getByLabel('昵称').fill('新昵称');
    const field=original.page.getByLabel('密码',{exact:true});
    assert.equal(await button(original.page,'显示密码').count(),0);
    await field.fill(password);
    await button(original.page,'显示密码').click();
    assert.equal(await field.getAttribute('type'),'text');
    await button(original.page,'登录').click();
    await original.page.getByText('昵称或密码有误。').waitFor();
    await field.fill(newPassword);
    await button(original.page,'登录').click();
    await shelf(original.page,'我').waitFor();
  } finally { await original.context.close(); await other.context.close(); }
});


test('周一至周日的色块和页码箭头配色一致',async()=>{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  try {
    const page=await context.newPage();
    const self={id:'palette',nickname:'晨读',avatar:0,avatarVersion:null};
    const friend={id:'partner',nickname:'晚读',avatar:0,avatarVersion:null};
    const days=Array.from({length:7},(_,index)=>({date:'2026-11-'+(9+index).toString().padStart(2,'0'), page:76+index*36}));
    const book={id:'weekly',title:'一周阅读',totalPages:345,currentPage:292,revision:7,completedOn:null,
      weekOpeningPage:40,beforeToday:256,days};
    await page.route('**/api/v1/me',route=>route.fulfill({json:{...self,friendCode:'demo',friend:{...friend,relationshipId:'pair'}}}));
    await page.route('**/api/v1/home',route=>route.fulfill({json:{
      date:'2026-11-15',serverNow:'2026-11-15T13:00:00Z',weekStart:'2026-11-09',timeZone:'Asia/Shanghai',relationshipId:'pair',
      self:{...self,books:[book]},friend:{...friend,books:[{...book,id:'companion',title:'周末手记'}]},
    }}));
    await page.goto(runtime.origin);
    const card=shelf(page,'我');
    await card.getByRole('heading',{name:'一周阅读'}).waitFor();
    const colors=await card.locator('.segment').evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).backgroundColor));
    const markers=await card.locator('.page-marker').evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node,'::before').borderRightColor));
    assert.deepEqual(colors,[
      'rgb(255, 179, 193)','rgb(255, 208, 168)','rgb(255, 240, 166)','rgb(200, 245, 194)',
      'rgb(189, 244, 236)','rgb(189, 215, 255)','rgb(224, 199, 255)',
    ]);
    assert.deepEqual(markers.slice(1,-1),colors);
    if (process.env.READING_TEST_PALETTE_SCREENSHOT) await page.screenshot({path:process.env.READING_TEST_PALETTE_SCREENSHOT});
  } finally { await context.close(); }
});


test('Service Worker 接管后仍能刷新首页及离线加载静态页面',async()=>{
  const {context,page}=await reader();
  try {
    await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
    const cached=await page.evaluate(async()=>{
      const keys=await caches.keys();
      const cache=await caches.open(keys.find(key=>key.startsWith('reading-shell-')));
      const response=await cache.match('/');
      return {status:response?.status,redirected:response?.redirected};
    });
    assert.deepEqual(cached,{status:200,redirected:false});
    assert.equal((await page.reload()).status(),200);
    await button(page,'登录').waitFor();
    await context.setOffline(true);
    assert.equal((await page.reload()).status(),200);
    await page.getByRole('heading',{name:'阅读打卡'}).waitFor();
    await button(page,'重试').waitFor();
  } finally {await context.close();}
});
