import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/__api': {
        target: apiTarget,
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/__api/, ''),
      },
    },
  },
  test: {
    environment: 'jsdom',
    exclude: ['node_modules', 'dist', 'e2e'],
    globals: true,
    setupFiles: './src/setup-tests.ts',
  },
});
