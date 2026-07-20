import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: 'game-art.spec.ts',
  timeout: 30_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 5173 --strictPort',
      url: 'http://127.0.0.1:5173/',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: 'PORT=8787 npm --prefix ws-server start',
      url: 'http://127.0.0.1:8787/healthz',
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
