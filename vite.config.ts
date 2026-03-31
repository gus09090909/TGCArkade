import { defineConfig } from 'vite';

export default defineConfig({
  /** Root deploy (Render, etc.): absolute `/assets/...` avoids broken relative URLs. */
  base: '/',
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3847',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2022',
  },
});
