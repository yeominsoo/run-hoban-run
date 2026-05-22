import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 220_000,
  reporter: [['list']],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:15173',
    trace: 'retain-on-failure'
  }
});
