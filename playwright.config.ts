import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: '**/*.spec.ts', fullyParallel: false, workers: 1,
  forbidOnly: !!process.env.CI, retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { serviceWorkers: 'block', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [ { name: 'chromium', use: { ...devices['Desktop Chrome'] } }, { name: 'webkit', use: { ...devices['Desktop Safari'] } }, { name: 'mobile', use: { ...devices['iPhone 13'] } } ],
});
