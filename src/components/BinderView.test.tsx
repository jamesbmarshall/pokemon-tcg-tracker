import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import BinderView, { type BinderSlot } from './BinderView';
import { renderWithProviders } from '../test/render';
import { resetStores, seedCollection } from '../test/ui-helpers';
import { makeEntry, makeSnapshot } from '../test/fixtures';

beforeEach(async () => {
  await resetStores();
  seedCollection();
});

const slots = (n: number, owned = (i: number) => i % 2 === 0): BinderSlot[] =>
  Array.from({ length: n }, (_, i) => ({ card: makeSnapshot({ id: `sv03-${String(i + 1).padStart(3, '0')}`, name: `Card ${i + 1}` }), owned: owned(i) }));

function stubWide(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

describe('BinderView', () => {
  it('paginates slots into 9-pocket pages', () => {
    renderWithProviders(<BinderView slots={slots(20)} />);
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
    expect(screen.getByText('p. 1')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(9);
  });

  it('pages with the Next and Previous buttons', async () => {
    renderWithProviders(<BinderView slots={slots(20)} />);
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    // Last page: 2 cards and 7 empty pockets
    expect(screen.getAllByRole('link')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
  });

  it('pages with the arrow keys, clamped at both ends', () => {
    renderWithProviders(<BinderView slots={slots(20)} />);
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
  });

  it('ignores arrow keys while typing in a field', () => {
    renderWithProviders(
      <>
        <input aria-label="filter" />
        <BinderView slots={slots(20)} />
      </>,
    );
    fireEvent.keyDown(screen.getByLabelText('filter'), { key: 'ArrowRight' });
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
  });

  it('shows owned cards and numbered placeholders for missing ones', () => {
    renderWithProviders(<BinderView slots={slots(2)} />);
    const owned = screen.getByTitle('Card 1 #1');
    expect(owned).toHaveAttribute('href', '/card/sv03-001');
    expect(within(owned).getByRole('img', { name: 'Card 1' })).toBeInTheDocument();
    const missing = screen.getByTitle('Card 2 #2');
    expect(within(missing).getByText('#2')).toBeInTheDocument();
  });

  it('adds a foil sheen to owned foil cards', () => {
    seedCollection({ entries: [makeEntry({ variant: 'reverseHolofoil' })], cards: [makeSnapshot()] });
    renderWithProviders(<BinderView slots={slots(2, () => true)} />);
    expect(screen.getByTitle('Card 1 #1').querySelector('.foil')).not.toBeNull();
    expect(screen.getByTitle('Card 2 #2').querySelector('.foil')).toBeNull();
  });

  it('shows a single empty page with no slots', () => {
    renderWithProviders(<BinderView slots={[]} />);
    expect(screen.getByText('Page 1 of 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('lays out 12-pocket pages in four columns', () => {
    const { container } = renderWithProviders(<BinderView slots={slots(13)} pocketSize={12} />);
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    expect(container.querySelector('.grid-cols-4')).not.toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(12);
  });

  it('shows two-page spreads on wide screens', async () => {
    stubWide(true);
    renderWithProviders(<BinderView slots={slots(30)} />);
    expect(screen.getByText('Pages 1–2 of 4')).toBeInTheDocument();
    expect(screen.getByText('p. 2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('Pages 3–4 of 4')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('labels a lone final page in a spread correctly', () => {
    stubWide(true);
    renderWithProviders(<BinderView slots={slots(5)} />);
    expect(screen.getByText('Pages 1–1 of 1')).toBeInTheDocument();
  });

  it('animates a page turn with the old page on the front of the leaf and the new one on its back', async () => {
    stubWide(true);
    renderWithProviders(<BinderView slots={slots(40)} />);
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    const leaf = screen.getByTestId('turning-leaf');
    expect(leaf).toHaveAttribute('aria-hidden', 'true');
    expect(leaf.style.animation).toContain('page-turn-forward');
    expect(leaf.style.transformOrigin).toBe('left center');
    expect(within(leaf).getByText('p. 2')).toBeInTheDocument();
    expect(within(leaf).getByText('p. 3')).toBeInTheDocument();
    // Underneath: the old left page stays put until the leaf covers it, the new right page is already there.
    expect(screen.getAllByText('p. 1')).toHaveLength(1);
    expect(screen.getAllByText('p. 4')).toHaveLength(1);
    await waitFor(() => expect(screen.queryByTestId('turning-leaf')).toBeNull());
    expect(screen.getByText('p. 3')).toBeInTheDocument();
    expect(screen.getByText('p. 4')).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    const back = screen.getByTestId('turning-leaf');
    expect(back.style.animation).toContain('page-turn-back');
    expect(back.style.transformOrigin).toBe('right center');
    expect(within(back).getByText('p. 3')).toBeInTheDocument();
    expect(within(back).getByText('p. 2')).toBeInTheDocument();
  });

  it('swings single pages around the rings and finishes even without animation events', () => {
    vi.useFakeTimers();
    renderWithProviders(<BinderView slots={slots(30)} />);
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    const leaf = screen.getByTestId('turning-leaf');
    expect(leaf.style.animation).toContain('page-turn-forward');
    expect(within(leaf).getByText('p. 1')).toBeInTheDocument();
    expect(screen.getAllByText('p. 2')).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByTestId('turning-leaf')).toBeNull();
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    const back = screen.getByTestId('turning-leaf');
    expect(back.style.animation).toContain('page-turn-in');
    expect(within(back).getByText('p. 1')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('clamps the current page when slots shrink', async () => {
    const { rerender } = render(<BinderView slots={slots(20)} />, { wrapper: MemoryRouter });
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    rerender(<BinderView slots={slots(5)} />);
    expect(screen.getByText('Page 1 of 1')).toBeInTheDocument();
  });
});
