# 阅读打卡

面向两位读者的移动 PWA。支持昵称密码注册、登录、书籍管理、每日累计页码和好友周进度。

## 本地运行

使用 Node.js 24。先初始化本地 D1 并构建静态资源。

```sh
npm ci
npm run build
npm run db:local
npm run dev
```

在浏览器打开 `http://localhost:8787` 或 `http://127.0.0.1:8787`，选择「注册账号」并输入昵称和密码。登录后可在「我的」点击个人卡片中的头像上传图片，或点击右侧箭头进入个人资料页。建书时可填写初始已读页数。填写朋友的邀请码并绑定成功后自动进入双栏首页。

如果提交时提示访问地址不匹配，请使用上述本机地址。自定义端口或部署域名时，`ORIGIN` 需与浏览器地址的协议、主机和端口一致。

编辑前端后用 `npm run build` 重新生成静态文件。用 `npm run check` 检查类型，`npm test` 运行 workerd/D1 和 Chrome 测试。测试优先使用本机安装的 Google Chrome，也支持 `READING_TEST_CHROME` 指定可执行文件或使用 `npx playwright install chromium` 安装测试用浏览器。

## 部署前配置

保留本地 Wrangler 配置。生产与远程预览分别从 `wrangler.jsonc` 复制为 `wrangler.production.jsonc` 和 `wrangler.preview.jsonc`，分别配置 Worker 名称、独立 D1 名称与 ID，以及固定 HTTPS `ORIGIN`，并移除本地专用的 `ALLOW_LOOPBACK_ALIAS`。自动生成的临时预览地址保持禁用。首次注册前在目标设备确认域名。

使用匹配环境的配置执行远程 D1 迁移和发布。以下命令会写入对应远程环境。

```sh
npm run build
npx wrangler d1 migrations apply DB --remote --config wrangler.production.jsonc
npx wrangler deploy --config wrangler.production.jsonc
```

先在独立预览环境重复本地验收，记录免费 Worker 的注册、登录和密码修改 CPU 时间。正式验收包括 Android Chrome、iPhone Safari 和双方主屏幕模式的注册、登录、打卡、断网草稿与好友同步。
