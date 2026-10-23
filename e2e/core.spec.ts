import { test, expect } from './fixtures';
import AxeBuilder from '@axe-core/playwright';
test.beforeEach(async ({ page }) => {
  await page.route('**/api/tcgdex/**', route => route.fulfill({ json: [] }));
  await page.goto('/');
  await page.getByLabel('Username', { exact: true }).fill('ash');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('main').getByText('Collection value', { exact: true })).toBeVisible();
});
test('built application is accessible, stays within the viewport and survives reload', async ({ page }) => {
  await expect(page.getByLabel('Valuation coverage')).toContainText('1 of 1');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations).toEqual([]);
  await page.reload();
  await expect(page.getByRole('main').getByText('Collection value', { exact: true })).toBeVisible();
});
test('opens an owned card immediately while its detail request is blocked', async ({ page }) => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/catalog/card/**', async route => { await blocked; await route.abort(); });
  await page.route('**/api/catalog/set/**', route => route.fulfill({ json: [] }));
  await page.goto('/collection');
  try {
    await page.getByRole('link', { name: /^Browser fixture card 001/ }).first().click();
    await expect(page.getByRole('heading', { name: 'Browser fixture card', exact: true })).toBeVisible({ timeout: 1000 });
  } finally { release(); }
});
test('native dialog contains keyboard focus and restores its opener', async ({ page }) => {
  await page.goto('/lists');
  const opener = page.getByRole('button', { name: 'New list', exact: true });
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'New list', exact: true });
  await expect(dialog.getByLabel('Name', { exact: true })).toBeFocused();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
});
test('failed writes stay visibly failed and do not become saved data', async ({ page }) => {
  await page.goto('/lists');
  await page.getByRole('button', { name: 'New list', exact: true }).click();
  const name = `unsaved-${Date.now()}`;
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill(name);
  await page.route('**/api/collections/*/lists', route => route.request().method() === 'POST' ? route.fulfill({ status: 503, json: { error: 'Storage temporarily unavailable' } }) : route.continue());
  await page.getByRole('button', { name: 'Create list', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Couldn’t save the list');
  await page.reload();
  await expect(page.getByRole('main')).not.toContainText(name);
});
test('lost successful response retries once with the same receipt key', async ({ page }) => {
  await page.goto('/lists');
  const name = `retry-${Date.now()}`;
  const keys: string[] = [];
  await page.route('**/api/collections/*/lists', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    keys.push(route.request().headers()['idempotency-key']);
    if (keys.length === 1) { await route.fetch(); await route.abort('failed'); }
    else await route.continue();
  });
  await page.getByRole('button', { name: 'New list', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Create list', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(keys).toHaveLength(2); expect(keys[0]).toBeTruthy(); expect(keys[0]).toBe(keys[1]);
  await page.reload();
  await expect(page.getByRole('main').getByText(name, { exact: true })).toHaveCount(1);
});
test('two tabs preserve the winning edit and keep a stale form open for review', async ({ page, context }) => {
  const name = `concurrency-${Date.now()}`;
  await page.goto('/lists');
  await page.getByRole('button', { name: 'New list', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Create list', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const other = await context.newPage();
  await other.goto(page.url());
  await expect(other.getByRole('heading', { name, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await other.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill(`${name}-winner`);
  await other.getByRole('dialog').getByLabel('Name', { exact: true }).fill(`${name}-stale`);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await other.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(other.getByRole('dialog')).toContainText('changed on another device');
  await expect(other.getByRole('dialog').getByLabel('Name', { exact: true })).toHaveValue(`${name}-stale`);
  await other.reload();
  await expect(other.getByRole('heading', { name: `${name}-winner`, exact: true })).toBeVisible();
  await other.close();
});
