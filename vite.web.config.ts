import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: 'web',
  publicDir: '../public',
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  define: { 'import.meta.env.VITE_FIREBASE': JSON.stringify('true') },
  build: { outDir: '../dist-web', emptyOutDir: true, sourcemap: false, target: 'es2022' },
  server: { host: '127.0.0.1', port: 5198, proxy: { '/api': 'http://127.0.0.1:5199' } },
});
