import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HomePage from './HomePage';
import { renderWithProviders } from '../test/render';
import { dayKey, loadingResult, queryResult, resetStores, seedCollection } from '../test/ui-helpers';
import { makeEntry, makeSet, makeSnapshot } from '../test/fixtures';
import { useCollectionStore } from '../store/collectionStore';
import type { ValuePoint } from '../api/types';

const mocks = vi.hoisted(() => ({ useSets: vi.fn() }));
vi.mock('../api/hooks', () => ({ useSets: mocks.useSets }));

const SETS = [
  makeSet({ id: 'sv04', name: 'Paradox Rift', total: 266 }),
  makeSet(),
  makeSet({ id: 'sv02', name: 'Paldea Evolved' }),
  makeSet({ id: 'sv01', name: 'Scarlet & Violet' }),
];

function seedDashboard(history: ValuePoint[] = []) {
  seedCollection({
    entries: [
      makeEntry({ quantity: 2, addedAt: '2025-01-01T00:00:00.000Z' }),
      makeEntry({ cardId: 'sv03-223', variant: 'holofoil', addedAt: '2025-01-04T00:00:00.000Z' }),
      makeEntry({ cardId: 'base1-4', variant: 'holofoil', addedAt: '2025-01-02T00:00:00.000Z' }),
      makeEntry({ cardId: 'tiny-1', addedAt: '2025-01-03T00:00:00.000Z' }),
    ],
    cards: [
      makeSnapshot(),
      makeSnapshot({ id: 'sv03-223', name: 'Charizard ex', prices: { holofoil: 20 } }),
      makeSnapshot({ id: 'base1-4', name: 'Blastoise', setName: 'Base', printedTotal: 102, prices: { holofoil: 10 } }),
      makeSnapshot({ id: 'tiny-1', name: 'Promo', setName: 'Tiny', printedTotal: 1, prices: {} }),
    ],
    wishlist: [
      { cardId: 'sv03-006', addedAt: '2025-01-01' },
      { cardId: 'gone-1', addedAt: '2025-01-01' },
    ],
    history,
  });
  useCollectionStore.setState((s) => ({ cards: new Map([...s.cards, ['sv03-006', makeSnapshot({ id: 'sv03-006', prices: { normal: 300, holofoil: 500 } })]]) }));
}
const point = (date: string, valueUsd: number): ValuePoint => ({ date, valueUsd, cards: 1, unique: 1 });
const stat = (label: string) => screen.getByText(label, { selector: '.eyebrow' }).parentElement!;
const stripNames = (title: string) =>
  within(screen.getByRole('heading', { name: title }).parentElement!.nextElementSibling as HTMLElement)
    .getAllByRole('link')
    .map((l) => l.querySelector('p')!.textContent);

beforeEach(async () => {
  vi.clearAllMocks();
  await resetStores();
  mocks.useSets.mockReturnValue(queryResult(SETS));
});

describe('HomePage', () => {
  it('shows a skeleton until the collection loads', () => {
    renderWithProviders(<HomePage />);
    expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  describe('welcome', () => {
    beforeEach(() => seedCollection());

    it('welcomes new collectors with the latest sets', () => {
      renderWithProviders(<HomePage />);
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent("Every card you own, and every one you don't.");
      expect(screen.getByRole('link', { name: /Start with Paradox Rift/ })).toHaveAttribute('href', '/sets/sv04');
      expect(screen.getByRole('link', { name: 'Browse all sets' })).toHaveAttribute('href', '/sets');
      expect(screen.getByRole('heading', { name: 'Count it properly' })).toBeInTheDocument();
      const latest = screen.getByRole('heading', { name: 'Latest releases' }).nextElementSibling as HTMLElement;
      const links = within(latest).getAllByRole('link');
      expect(links.map((l) => l.getAttribute('href')).slice(0, 3)).toEqual(['/sets/sv04', '/sets/sv03', '/sets/sv02']);
      expect(links[0]).toHaveTextContent('11 Aug 2023 · 266 cards');
    });

    it('shows placeholders while sets load', () => {
      mocks.useSets.mockReturnValue(loadingResult());
      renderWithProviders(<HomePage />);
      expect(screen.queryByRole('link', { name: /Start with/ })).not.toBeInTheDocument();
      const latest = screen.getByRole('heading', { name: 'Latest releases' }).nextElementSibling as HTMLElement;
      expect(latest.querySelectorAll('.animate-pulse')).toHaveLength(3);
    });
  });

  describe('dashboard', () => {
    it('summarises value and counts', () => {
      seedDashboard();
      renderWithProviders(<HomePage />);
      // $2 + $20 + $10 = $32 → £16.00
      expect(stat('Collection value')).toHaveTextContent('£16.00');
      expect(stat('Cards')).toHaveTextContent('54 unique');
      expect(stat('Sets started')).toHaveTextContent('31 complete');
      expect(stat('Avg. card')).toHaveTextContent('£3.20per copy');
      const wish = screen.getByRole('link', { name: /Wishlist/ });
      expect(wish).toHaveAttribute('href', '/wishlist');
      // cheapest wished price is $300 → £150; unknown cards are skipped
      expect(wish).toHaveTextContent('Wishlist2≈ £150 to buy');
      expect(screen.getByText(/Your value history builds up day by day/)).toBeInTheDocument();
    });

    it('says when the wishlist is empty', () => {
      seedDashboard();
      useCollectionStore.setState({ wishlist: new Map() });
      renderWithProviders(<HomePage />);
      expect(screen.getByRole('link', { name: /Wishlist/ })).toHaveTextContent('Nothing yet');
    });

    it('lists sets in progress with base, secret and remaining counts', () => {
      seedDashboard();
      renderWithProviders(<HomePage />);
      expect(screen.getByRole('link', { name: 'All sets →' })).toHaveAttribute('href', '/sets?filter=started');
      const grid = screen.getByRole('heading', { name: 'Sets in progress' }).parentElement!.nextElementSibling as HTMLElement;
      const links = within(grid).getAllByRole('link');
      expect(links.map((l) => l.getAttribute('href'))).toEqual(['/sets/base1', '/sets/sv03', '/sets/tiny']);
      expect(links[1]).toHaveTextContent('1/197 base + 1 secret · 196 to go');
      expect(links[0]).toHaveTextContent('1/102 base · 101 to go');
      expect(links[2]).toHaveTextContent('1/1 base · complete ✦');
      // set symbols only appear for sets in the catalogue
      expect(links[1].querySelector('img')).toBeInTheDocument();
      expect(links[0].querySelector('img')).not.toBeInTheDocument();
    });

    it('lists the closest incomplete sets', () => {
      seedDashboard();
      renderWithProviders(<HomePage />);
      const panel = screen.getByText('Closest to complete').parentElement!;
      expect(within(panel).getAllByText(/^(Base|Obsidian Flames|Tiny)$/).map((n) => n.textContent)).toEqual(['Base', 'Obsidian Flames']);
    });

    it('shows most valuable and recently added strips', () => {
      seedDashboard();
      renderWithProviders(<HomePage />);
      expect(stripNames('Most valuable')).toEqual(['Charizard ex', 'Blastoise', 'Charmander', 'Promo']);
      expect(stripNames('Recently added')).toEqual(['Charizard ex', 'Promo', 'Blastoise', 'Charmander']);
      expect(screen.getAllByRole('link', { name: 'See all →' }).map((l) => l.getAttribute('href'))).toEqual(['/collection?sort=value', '/collection?sort=added']);
      expect(screen.getAllByRole('link', { name: /Charizard ex/ })[0]).toHaveAttribute('href', '/card/sv03-223');
    });

    it('shows a gain against the earliest value in the last 30 days', () => {
      seedDashboard([point(dayKey(-40), 1), point(dayKey(-10), 16), point(dayKey(0), 32)]);
      renderWithProviders(<HomePage />);
      expect(stat('Collection value')).toHaveTextContent('+£8.00 (100.0%)');
    });

    it('shows a loss', () => {
      seedDashboard([point(dayKey(-5), 64), point(dayKey(0), 32)]);
      renderWithProviders(<HomePage />);
      expect(stat('Collection value')).toHaveTextContent('−£16.00 (50.0%)');
    });

    it('shows no change when the value is flat', () => {
      seedDashboard([point(dayKey(-5), 32), point(dayKey(0), 32)]);
      renderWithProviders(<HomePage />);
      expect(screen.getByText('No change')).toBeInTheDocument();
    });

    it('hides the delta with only one recent point', () => {
      seedDashboard([point(dayKey(-40), 1), point(dayKey(0), 32)]);
      renderWithProviders(<HomePage />);
      expect(screen.queryByText(/\(\d+\.\d%\)/)).not.toBeInTheDocument();
      expect(screen.queryByText('No change')).not.toBeInTheDocument();
    });
  });

  describe('purchase prices', () => {
    const paidDashboard = () => {
      seedDashboard([point('2025-01-01', 30), { ...point('2025-01-02', 32), costUsd: 10, costedValueUsd: 22 }, { ...point('2025-01-03', 32), costUsd: 10, costedValueUsd: 24 }]);
      useCollectionStore.setState((s) => {
        const entries = new Map(s.entries);
        entries.set('sv03-223::holofoil', { ...entries.get('sv03-223::holofoil')!, paid: { amount: 5, currency: 'GBP' } });
        return { entries };
      });
    };

    it('hides cost UI until a price is recorded', () => {
      seedDashboard();
      renderWithProviders(<HomePage />);
      expect(screen.queryByRole('radio', { name: 'Gain / loss' })).not.toBeInTheDocument();
      expect(stat('Avg. card')).toBeInTheDocument();
    });

    it('summarises cost against value and swaps in a gain stat', () => {
      paidDashboard();
      renderWithProviders(<HomePage />);
      // Paid £5 ($10) for the Charizard now worth $20 → £10
      expect(screen.getByText(/now worth/)).toHaveTextContent(/^Paid £5\.00 for 1 of 5 cards, now worth £10\.00/);
      expect(stat('Gain / loss')).toHaveTextContent('+£5.00');
      expect(stat('Gain / loss')).toHaveTextContent('+100% on 1 card with a price paid');
      expect(screen.queryByText('Avg. card', { selector: '.eyebrow' })).not.toBeInTheDocument();
    });

    it('toggles the chart to gain / loss and remembers it', async () => {
      paidDashboard();
      const { unmount } = renderWithProviders(<HomePage />);
      expect(screen.getByRole('radio', { name: 'Value' })).toHaveAttribute('aria-checked', 'true');
      await userEvent.click(screen.getByRole('radio', { name: 'Gain / loss' }));
      expect(screen.getByTestId('zero-line')).toBeInTheDocument();
      unmount();
      renderWithProviders(<HomePage />);
      expect(screen.getByRole('radio', { name: 'Gain / loss' })).toHaveAttribute('aria-checked', 'true');
    });
  });

});
