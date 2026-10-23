import { test as base, expect } from '@playwright/test';
import { startBrowserServer } from './server';

/** Each test owns its real server and database, including login limits and revisions. */
export const test = base.extend<{
  app: Awaited<ReturnType<typeof startBrowserServer>>;
}>({
  // Playwright requires destructuring even when a fixture has no dependencies.
  // eslint-disable-next-line no-empty-pattern
  app: async ({}, provide) => {
    const app = await startBrowserServer();
    try {
      await provide(app);
    } finally {
      await app.close();
    }
  },
  baseURL: async ({ app }, provide) => {
    await provide(app.url);
  },
});
export { expect };
