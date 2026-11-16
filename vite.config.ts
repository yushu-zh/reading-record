import { defineConfig } from 'vite';

export default defineConfig({
  root: 'apps/web',
  oxc: { jsx: { runtime: 'automatic' } },
  build: { outDir: '../../dist', emptyOutDir: true },
});
