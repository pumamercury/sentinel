import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
export default defineConfig({
  css: { postcss: { plugins: [tailwindcss()] } },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    fs: {
      deny: [
        '.env',
        '.env.*',
        '*.{crt,pem,key}',
        '**/.git/**',
        '**/data/**',
        '**/migration-backups/**',
        '**/*.{sqlite,sqlite-wal,sqlite-shm,db,db-wal,db-shm}',
      ],
    },
    watch: { ignored: ['**/data/**'] },
  },
  plugins: [
    vinext(),
    {
      name: 'local-database',
      async configureServer(server) {
        const { createApi } = await import('./server/api.mjs');
        const api = createApi();
        server.middlewares.use(api.handler);
        server.httpServer?.once('close', () => api.close());
      },
    },
  ],
});
