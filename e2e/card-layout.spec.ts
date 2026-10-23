import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import AxeBuilder from '@axe-core/playwright';
import { magicLeader, magicForest, magicSet } from './tcg-fixtures';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/tcgdex/**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/catalog/card/**', () => {});
  await page.route('**/api/games/mtg/sets**', (route) =>
    route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/sets')
        ? [magicSet]
        : { cards: [magicLeader, magicForest], complete: true },
    }),
  );
  await page.route('**/api/games/mtg/search**', (route) =>
    route.fulfill({ json: { cards: [], total: 0, hasMore: false } }),
  );
  await page.goto('/');
  await page.getByLabel('Username', { exact: true }).fill('ash');
  await page
    .getByLabel('Password', { exact: true })
    .fill('correct horse battery');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('main')).toBeVisible();
});

async function geometry(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  return page.locator('[data-card-detail]').evaluate((root) => {
    const rect = (selector: string) => {
      const r = root.querySelector(selector)!.getBoundingClientRect();
      return { x: r.x, width: r.width };
    };
    const h1 = getComputedStyle(root.querySelector('h1')!);
    const column = getComputedStyle(root.querySelector('[data-card-columns]')!);
    return {
      art: rect('[data-card-artwork]'),
      content: rect('[data-card-content]'),
      columns: column.gridTemplateColumns,
      gap: column.columnGap,
      title: { size: h1.fontSize, font: h1.fontFamily, weight: h1.fontWeight },
      collection: getComputedStyle(
        root.querySelector('[data-card-collection]')!,
      ).borderTopWidth,
      notes: root.querySelector('textarea')?.className,
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
}
for (const width of [1440, 390, 320]) {
  test(`uses the same Pokemon and Magic card geometry at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 });
    await page.goto('/card/sv1-001');
    await expect(
      page.getByRole('heading', { name: 'Browser fixture card', exact: true }),
    ).toBeVisible();
    const pokemon = await geometry(page);
    await page.goto(`/mtg/card/${encodeURIComponent(magicLeader.id)}`);
    await expect(
      page.getByRole('heading', { name: magicLeader.name, exact: true }),
    ).toBeVisible();
    const magic = await geometry(page);
    expect(magic).toEqual(pokemon);
    expect(magic.overflow).toBe(false);
    await expect(page.getByLabel('Notes about this card')).toBeVisible();
    await page.getByRole('button', { name: 'Add Normal copy', exact: true }).click();
    await expect(page.getByLabel('Condition of Normal copy')).toBeVisible();
    const violations = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(violations.violations).toEqual([]);
  });
}

test('uses collection controls and keeps set navigation out of an open dialog', async ({
  page,
}) => {
  await page.goto(`/mtg/card/${encodeURIComponent(magicLeader.id)}`);
  await expect(
    page.getByRole('heading', { name: magicLeader.name, exact: true }),
  ).toBeVisible();
  await expect(page.getByText('1/2', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Add Foil copy', exact: true })
    .click();
  await expect(page.getByLabel('Condition of Foil copy')).toBeVisible();
  await page.getByRole('button', { name: 'Lists', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Add to a list or deck' }),
  ).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(
    new RegExp(encodeURIComponent(magicLeader.id) + '$'),
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(
    new RegExp(encodeURIComponent(magicLeader.id) + '$'),
  );
  await page.getByRole('button', {name:'Remove one Foil',exact:true}).click();
  await expect(page.getByLabel('Condition of Foil copy')).toHaveCount(0);
  await page.locator('h1').click();
  await page.keyboard.press('ArrowRight');
  await expect(
    page.getByRole('heading', { name: 'Forest', exact: true }),
  ).toBeVisible();
});
