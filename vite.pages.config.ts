import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import supabase from './hosted/supabase.json';
import tailwindcss from '@tailwindcss/postcss';
import { fileURLToPath } from 'node:url';
const path = (value: string) => fileURLToPath(new URL(value, import.meta.url));
export default defineConfig({
  define: {
    'import.meta.env.VITE_SENTINEL_CLOUD': JSON.stringify('true'),
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabase.url),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(
      supabase.publishableKey,
    ),
  },
  root: path('./hosted'),
  base: process.env.SENTINEL_PAGES_BASE || '/sentinel/',
  publicDir: path('./public'),
  plugins: [react()],
  css: { postcss: { plugins: [tailwindcss()] } },
  resolve: {
    alias: {
      'next/link': path('./hosted/link.tsx'),
      'next/navigation': path('./hosted/navigation.tsx'),
    },
  },
  build: { outDir: path('./dist-pages'), emptyOutDir: true },
});
