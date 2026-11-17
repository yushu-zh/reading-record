# 阅读打卡

面向两位读者的移动 PWA。支持昵称密码注册、登录、书籍管理、每日累计页码和好友周进度。

## 本地运行

使用 Node.js 24。开发服务会自动初始化本地 PostgreSQL，数据保存在 `.local-postgres/`。

```sh
npm ci
npm run dev
```

在浏览器打开 `http://127.0.0.1:8787`，选择「注册账号」并输入昵称和密码。登录后可在「我的」点击个人卡片中的头像上传图片，或点击右侧箭头进入个人资料页。建书时可填写初始已读页数。填写朋友的邀请码并绑定成功后自动进入双栏首页。

如果提交时提示访问地址不匹配，请使用上面的本机地址。自定义端口或部署域名时，`ORIGIN` 需与浏览器地址的协议、主机和端口一致。

更改前端或 API 后重新运行 `npm run dev`。用 `npm run check` 检查类型，`npm test` 运行 PostgreSQL API、CloudBase 网关和 Chrome 回归测试。测试优先使用本机安装的 Google Chrome，也支持 `READING_TEST_CHROME` 指定可执行文件或使用 `npx playwright install chromium` 安装测试用浏览器。

## 腾讯云 CloudBase 部署

使用 PostgreSQL 环境和云托管。通过 Git 仓库部署时，选择 `main` 分支和仓库根目录。通过源码包部署时，上传包包含根目录的 `Dockerfile`、`package.json`、`package-lock.json`、`vite.config.ts`、`apps/`、`packages/` 和 `scripts/`。服务监听 8080，以 `/healthz` 做健康检查。

免费共享 PostgreSQL 使用 CloudBase HTTPS 网关。在目标环境按顺序执行 `apps/tencent/migrations/` 中的 SQL，并将 `CLOUDBASE_ENV_ID`、服务端 `CLOUDBASE_API_KEY` 和 `ORIGIN` 配置为云托管环境变量。`ORIGIN` 必须等于浏览器使用的完整 HTTPS origin。只有支持 PostgreSQL 协议直连的环境才使用 `DATABASE_URL`。

预览和生产分别配置数据库和固定域名。正式验收包括 Android Chrome、iPhone Safari 和各自主屏幕模式的注册、登录、打卡、断网草稿与好友同步。免费环境的默认域名只用于测试。
