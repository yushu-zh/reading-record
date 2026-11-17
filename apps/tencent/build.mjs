import { build } from 'vite';

await build({
  configFile: false,
  build: {
    ssr: true,
    rolldownOptions: {
      input: {
        server: 'apps/tencent/server.ts',
        app: 'apps/tencent/app.ts',
        database: 'apps/tencent/database.ts',
        gateway: 'apps/tencent/gateway.ts',
      },
    },
    target: 'node24',
    outDir: '.tencent-build',
    emptyOutDir: true,
  },
});
