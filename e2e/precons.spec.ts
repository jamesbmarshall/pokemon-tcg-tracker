import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { magicLeader, magicForest, magicSet } from './tcg-fixtures';
const precon = {
  id: 'DeepClueSea_MKC',
  game: 'mtg',
  name: 'Deep Clue Sea',
  setCode: 'MKC',
  releaseDate: '2024-02-09',
  format: 'commander',
  total: 100,
  catalogueUrl: 'https://mtgjson.com/',
  attribution: 'Decklists from MTGJSON',
  cards: [
    {
      name: magicLeader.name,
      providerId: magicLeader.providerId,
      cardId: magicLeader.id,
      image: '',
      quantity: 1,
      zone: 'commander',
      setCode: 'MKC',
      number: '3',
      finish: 'foil',
    },
    {
      name: magicForest.name,
      providerId: magicForest.providerId,
      cardId: magicForest.id,
      image: '',
      quantity: 99,
      zone: 'main',
      setCode: 'MKC',
      number: '10',
      finish: 'nonfoil',
    },
  ],
};
const resolved = {
  cards: [magicLeader, magicForest],
  items: [
    { cardId: magicLeader.id, quantity: 1, zone: 'commander' },
    { cardId: magicForest.id, quantity: 99, zone: 'main' },
  ],
  unresolved: [],
};
test.beforeEach(async ({ page }) => {
  await page.route('**/api/tcgdex/**', (r) => r.fulfill({ json: [] }));
  await page.route('**/api/games/mtg/search**', (r) =>
    r.fulfill({ json: { cards: [], total: 0, hasMore: false } }),
  );
  await page.route('**/api/games/mtg/sets**', (r) =>
    r.fulfill({
      json: new URL(r.request().url()).pathname.endsWith('/sets')
        ? [magicSet]
        : { cards: [magicLeader, magicForest], complete: true },
    }),
  );
  await page.route('**/api/games/mtg/precons**', (r) => {
    const path = new URL(r.request().url()).pathname;
    return r.fulfill({
      json: path.endsWith('/cards')
        ? resolved
        : path.endsWith('/DeepClueSea_MKC')
          ? precon
          : { decks: [precon], stale: false },
    });
  });
  await page.goto('/');
  await page.getByLabel('Username', { exact: true }).fill('ash');
  await page
    .getByLabel('Password', { exact: true })
    .fill('correct horse battery');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('main')).toBeVisible();
});
test('finds Deep Clue Sea from card search, previews it and saves a complete Commander deck', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/mtg/search?q=Deep+Clue+Sea');
  await page
    .getByRole('link', { name: 'Search precons for this name', exact: false })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Search precons', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Precon name or set')).toHaveValue(
    'Deep Clue Sea',
  );
  await page.getByRole('link', { name: /Deep Clue Sea/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Deep Clue Sea', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/100 cards · Commander/)).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Main deck 99', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(axe.violations).toEqual([]);
  await page.getByRole('button', { name: 'Save as deck', exact: true }).click();
  await expect(
    page.getByText('All 100 cards resolved · ready to save'),
  ).toBeVisible();
  const name = `Deep Clue Sea ${Date.now()}`;
  await page.getByLabel('Deck name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Save deck', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Legal in Commander', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(
    page.getByLabel('Quantity of Forest', { exact: true }),
  ).toHaveValue('99');
});
test('blocks saving when a precon printing is unavailable', async ({
  page,
}) => {
  await page.route('**/api/games/mtg/precons/DeepClueSea_MKC/cards', (r) =>
    r.fulfill({
      json: {
        cards: [magicLeader],
        items: [resolved.items[0]],
        unresolved: [precon.cards[1]],
      },
    }),
  );
  let writes = 0;
  page.on('request', (r) => {
    if (r.method() === 'PUT' && r.url().includes('/records')) writes++;
  });
  await page.goto('/mtg/precons/DeepClueSea_MKC');
  await page.getByRole('button', { name: 'Save as deck', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    'Forest',
  );
  await expect(
    page.getByRole('button', { name: 'Save deck', exact: true }),
  ).toBeDisabled();
  expect(writes).toBe(0);
});
