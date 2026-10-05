import { describe, it, expect, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import CardGrid from './CardGrid';
import { renderWithProviders } from '../test/render';
import { resetStores, seedCollection } from '../test/ui-helpers';
import { makeCard, makeEntry, makeSnapshot } from '../test/fixtures';

beforeEach(async () => {
  await resetStores();
  seedCollection();
});

describe('CardGrid', () => {
  it('renders a tile for each card in order', () => {
    renderWithProviders(
      <CardGrid cards={[makeSnapshot({ id: 'sv03-001', name: 'Charmander' }), makeCard({ id: 'sv03-002', name: 'Charmeleon' }), makeSnapshot({ id: 'sv03-003', name: 'Charizard' })]} />,
    );
    const names = screen.getAllByRole('link', { name: /owned/ }).map((l) => l.getAttribute('aria-label'));
    expect(names).toEqual(['Charmander 1, not owned', 'Charmeleon 002, not owned', 'Charizard 3, not owned']);
  });

  it('renders nothing for an empty list', () => {
    const { container } = renderWithProviders(<CardGrid cards={[]} />);
    expect(container.querySelector('.grid')).toBeEmptyDOMElement();
  });

  it('passes showSet, dimMissing and quickAdd through to tiles', () => {
    seedCollection({ entries: [makeEntry()], cards: [makeSnapshot()] });
    renderWithProviders(<CardGrid cards={[makeSnapshot(), makeSnapshot({ id: 'sv03-002', name: 'Charmeleon' })]} showSet dimMissing quickAdd />);
    expect(screen.getByText('Obsidian Flames · #1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove one Normal' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Charmeleon' })).toHaveClass('text-muted');
  });
});
