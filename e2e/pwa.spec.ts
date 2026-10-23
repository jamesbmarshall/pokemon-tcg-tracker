import { readFileSync, writeFileSync } from 'node:fs';
import { test, expect } from './fixtures';
test.use({ serviceWorkers: 'allow' });
test('installed service worker prompts for update and preserves an open edit', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Service-worker update lifecycle is exercised in Chromium.');
  await page.goto('/');
  await page.getByLabel('Username', { exact: true }).fill('ash');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('main').getByText('Collection value', { exact: true })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload(); // Let the initial worker control this document before publishing an update.
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.goto('/lists');
  await page.getByRole('button', { name: 'New list', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Keep this unsaved edit');
  const file = 'apps/web/dist/sw.js'; const original = readFileSync(file, 'utf8');
  try {
    writeFileSync(file, original + `\n// browser update fixture ${Date.now()}\n`);
    await page.evaluate(async () => { const registration = await navigator.serviceWorker.ready; await registration.update(); });
    await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.ready).waiting), { timeout: 15_000 }).toBe(true);
    await expect(page.getByRole('dialog').getByLabel('Name', { exact: true })).toHaveValue('Keep this unsaved edit');
    await page.keyboard.press('Escape');
    await expect(page.getByText('A new version of PokéTracker is ready.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reload', exact: true })).toBeVisible();
  } finally { writeFileSync(file, original); }
});
