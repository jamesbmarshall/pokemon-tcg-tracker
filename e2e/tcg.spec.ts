import { test, expect } from './fixtures';
import AxeBuilder from '@axe-core/playwright';
import { magicLeader, magicForest, magicSet } from './tcg-fixtures';
test.beforeEach(async ({ page }) => {
  await page.route('**/api/tcgdex/**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/games/mtg/sets**', (route) =>
    route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/sets')
        ? [magicSet]
        : { cards: [magicLeader, magicForest], complete: true },
    }),
  );
  await page.goto('/');
  await page.getByLabel('Username', { exact: true }).fill('ash');
  await page
    .getByLabel('Password', { exact: true })
    .fill('correct horse battery');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page
    .getByLabel('Trading card game')
    .filter({ visible: true })
    .selectOption('mtg');
  await expect(
    page.getByRole('heading', { name: 'Magic: The Gathering', exact: true }),
  ).toBeVisible();
});
test('switches games, collects a printing, and keeps the Magic view after reload', async ({
  page,
}) => {
  await page.goto('/mtg/sets/mtg%3Atst');
  await expect(page.getByText('Distinct cards', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Add nonfoil Fixture Commander', exact: true })
    .click();
  await expect(page.getByText('1 owned', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('1 owned', { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(axe.violations).toEqual([]);
  await page.route('**/api/games/mtg/cards/**', () => {});
  await page
    .getByRole('link', { name: 'Fixture Commander', exact: true })
    .last()
    .click();
  await expect(
    page.getByRole('heading', { name: 'Fixture Commander', exact: true }),
  ).toBeVisible();
  await page
    .getByLabel('Trading card game')
    .filter({ visible: true })
    .selectOption('pokemon');
  await expect(
    page.getByRole('main').getByText('Collection value', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('main')).not.toContainText('Fixture Commander');
});
test('imports a Commander deck through preview, validates it, and shares a read-only deck', async ({
  page,
}) => {
  await page.route('**/api/games/mtg/decks/resolve', (route) =>
    route.fulfill({
      json: {
        errors: [],
        resolved: [
          {
            row: {
              name: magicLeader.name,
              quantity: 1,
              zone: 'commander',
              line: 2,
            },
            candidates: [magicLeader],
          },
          {
            row: {
              name: magicForest.name,
              quantity: 99,
              zone: 'main',
              line: 4,
            },
            candidates: [magicForest],
          },
        ],
      },
    }),
  );
  await page.goto('/mtg/lists');
  const name = `Commander ${Date.now()}`;
  await page
    .getByRole('button', { name: 'New Commander deck', exact: true })
    .click();
  await page.getByLabel('List or deck name').fill(name);
  await page
    .getByRole('button', { name: 'Create Commander deck', exact: true })
    .click();
  await page.getByRole('link', { name: new RegExp(name) }).click();
  await page.getByRole('button', { name: 'Import text', exact: true }).click();
  await page
    .getByLabel('Decklist', { exact: true })
    .fill('Commander\n1 Fixture Commander\nDeck\n99 Forest');
  await page
    .getByRole('button', { name: 'Preview import', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Replace with previewed cards', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Legal in Commander', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Legal in Commander', exact: true }),
  ).toBeVisible();
  await page.goto('/mtg/sharing');
  await page
    .getByRole('button', { name: 'New share link', exact: true })
    .click();
  await page
    .getByRole('combobox', { name: 'What to share', exact: true })
    .selectOption('list');
  await page
    .getByRole('combobox', { name: 'List or deck', exact: true })
    .selectOption({ label: name });
  await page
    .getByRole('button', { name: 'Create share link', exact: true })
    .click();
  const link = page.getByRole('link', { name: 'Open shared view →' });
  await expect(link).toBeVisible();
  await page.goto((await link.getAttribute('href'))!);
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(
    page.getByText('commander · 1 × Fixture Commander', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /Save|Add card/ })).toHaveCount(
    0,
  );
});

test('keeps Magic selected across universal settings, admin and sharing on a phone', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('link', { name: 'Lists & decks', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Lists & decks', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(
    page.getByRole('heading', { name: 'Magic data', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Appearance', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Server', exact: true })).toBeVisible();
  const game = page.getByLabel('Trading card game').filter({ visible: true });
  await expect(game).toHaveValue('mtg');
  await page.getByRole('link', { name: 'Users, invites, jobs & backups', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(game).toHaveValue('mtg');
  await page.reload();
  await expect(game).toHaveValue('mtg');
  await page.getByRole('link', { name: 'Sharing', exact: true }).click();
  await expect(page).toHaveURL(/\/sharing$/);
  await expect(page.getByRole('heading', { name: 'Share Magic', exact: true })).toBeVisible();
  await expect(game).toHaveValue('mtg');
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(axe.violations).toEqual([]);
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
});
