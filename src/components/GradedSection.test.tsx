import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GradedSection from './GradedSection';
import { renderWithProviders } from '../test/render';
import { resetStores, seedCollection } from '../test/ui-helpers';
import { makeCard, makeEntry, makeGraded, makeSnapshot } from '../test/fixtures';
import { useCollectionStore } from '../store/collectionStore';
import { useToasts } from '../store/toastStore';
import { db } from '../db/dexie';

vi.mock('../db/imageCache', () => ({ cacheImages: vi.fn(async () => {}), pruneImages: vi.fn(async () => {}) }));

const card = makeCard({ id: 'sv03-001' });
const variants = Object.keys(card.tcgplayer?.prices ?? {});
const store = () => useCollectionStore.getState();
const toasts = () => useToasts.getState().toasts.map((t) => t.message);

async function openForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /add graded copy/i }));
  return screen.findByRole('dialog', { name: /add a graded copy/i });
}

beforeEach(async () => {
  vi.clearAllMocks();
  await resetStores();
  seedCollection({ cards: [makeSnapshot({ id: 'sv03-001', prices: { normal: 2, reverseHolofoil: 5 } })] });
});

describe('GradedSection', () => {
  it('shows an empty prompt when there are no slabs', () => {
    renderWithProviders(<GradedSection card={card} />);
    expect(screen.getByRole('heading', { name: /no graded copies/i })).toBeInTheDocument();
    expect(screen.getByText(/got this card in a slab/i)).toBeInTheDocument();
  });

  it('adds a PSA 10 with cert, label defaults and smart "counts" default', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GradedSection card={card} />);
    const dialog = await openForm(user);
    // portalled to body so ancestors can't clip it
    expect(dialog.closest('section')).toBeNull();
    expect(within(dialog).getByLabelText(/label/i)).toHaveValue('Gem Mint');
    const counts = within(dialog).getByRole('checkbox', { name: /counts towards set/i });
    expect(counts).toBeChecked(); // no raw copy owned
    await user.type(within(dialog).getByLabelText(/cert number/i), '81234567');
    await user.click(within(dialog).getByRole('button', { name: /^add graded copy$/i }));

    await waitFor(() => expect(store().graded.size).toBe(1));
    const g = [...store().graded.values()][0];
    expect(g).toMatchObject({ company: 'PSA', grade: '10', label: 'Gem Mint', certNumber: '81234567', countsTowardSet: true, variant: variants[0] });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: '1 slab' })).toBeInTheDocument();
    expect(screen.getByText('81234567')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /verify/i })).toHaveAttribute('href', 'https://www.psacard.com/cert/81234567');
    expect(toasts().some((t) => /Added .* PSA 10/.test(t))).toBe(true);
  });

  it('defaults to excluded when a raw copy of the same printing is already owned', async () => {
    seedCollection({ entries: [makeEntry({ cardId: 'sv03-001', variant: variants[0] })], cards: [makeSnapshot({ id: 'sv03-001' })] });
    const user = userEvent.setup();
    renderWithProviders(<GradedSection card={card} />);
    const dialog = await openForm(user);
    expect(within(dialog).getByRole('checkbox', { name: /counts towards set/i })).not.toBeChecked();
    expect(within(dialog).getByText(/kept out of the binder/i)).toBeInTheDocument();
  });

  it('re-scales grades and labels when the grader changes, and requires a name for Other', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GradedSection card={card} />);
    const dialog = await openForm(user);
    await user.selectOptions(within(dialog).getByLabelText('Grader'), 'BGS');
    await user.selectOptions(within(dialog).getByLabelText('Grade'), '9.5');
    expect(within(dialog).getByLabelText(/label/i)).toHaveValue('Gem Mint');
    await user.selectOptions(within(dialog).getByLabelText('Grade'), '10');
    expect(within(dialog).getByLabelText(/label/i)).toHaveValue('Pristine');
    await user.selectOptions(within(dialog).getByLabelText('Grader'), 'ACE');
    expect(within(dialog).getByLabelText('Grade')).toHaveValue('10');
    expect(within(dialog).queryByRole('option', { name: '9.5' })).toBeNull();
    await user.selectOptions(within(dialog).getByLabelText('Grader'), 'Other');
    expect(within(dialog).getByLabelText(/grading company/i)).toBeRequired();
  });

  it('records sub-grades and converts the valuation from display currency to USD', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GradedSection card={card} />);
    const dialog = await openForm(user);
    await user.selectOptions(within(dialog).getByLabelText('Grader'), 'BGS');
    await user.click(within(dialog).getByRole('button', { name: /add sub-grades/i }));
    await user.type(within(dialog).getByLabelText('centering'), '9.5');
    await user.type(within(dialog).getByLabelText('surface'), '10');
    await user.type(within(dialog).getByLabelText(/your valuation/i), '£150');
    await user.click(within(dialog).getByRole('button', { name: /^add graded copy$/i }));
    await waitFor(() => expect(store().graded.size).toBe(1));
    const g = [...store().graded.values()][0];
    expect(g.subgrades).toEqual({ centering: 9.5, surface: 10 });
    expect(g.valueUsd).toBe(300); // GBP rate 0.5 in tests
    expect(await screen.findByText('your value')).toBeInTheDocument();
  });

  it('saves attached photos and shows them in a lightbox', async () => {
    // fake-indexeddb clones Blobs into plain objects, which Node's createObjectURL rejects
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const user = userEvent.setup();
    renderWithProviders(<GradedSection card={card} />);
    const dialog = await openForm(user);
    const file = new File(['img'], 'slab.jpg', { type: 'image/jpeg' });
    await user.upload(within(dialog).getByLabelText(/add photos/i), file);
    expect(within(dialog).getAllByRole('button', { name: /remove photo/i })).toHaveLength(1);
    await user.click(within(dialog).getByRole('button', { name: /^add graded copy$/i }));
    await waitFor(async () => expect(await db.gradedPhotos.count()).toBe(1));
    const view = await screen.findByRole('button', { name: /view 1 photo/i });
    await user.click(view);
    expect(screen.getByRole('dialog', { name: /PSA 10/ })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on Escape and Cancel without saving', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GradedSection card={card} />);
    await openForm(user);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await openForm(user);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(store().graded.size).toBe(0);
  });

  it('lists slabs best first, toggles set inclusion, edits and removes with undo', async () => {
    seedCollection({
      cards: [makeSnapshot({ id: 'sv03-001', prices: { normal: 2 } })],
      graded: [makeGraded({ id: 'a', grade: '9', certNumber: undefined }), makeGraded({ id: 'b', company: 'BGS', grade: '10', label: 'Black Label', certNumber: '55' })],
    });
    await db.graded.bulkPut([...store().graded.values()]);
    const user = userEvent.setup();
    renderWithProviders(<GradedSection card={card} />);
    expect(screen.getByRole('heading', { name: '2 slabs' })).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Black Label');
    expect(within(items[0]).getByRole('link', { name: /verify/i })).toHaveAttribute('href', expect.stringContaining('beckett.com'));
    expect(within(items[1]).queryByText(/cert/i)).toBeNull();

    await user.click(within(items[1]).getByRole('checkbox', { name: /counts towards set/i }));
    await waitFor(() => expect(store().graded.get('a')?.countsTowardSet).toBe(false));
    expect(store().holdings.get('sv03-001')).toEqual({ normal: 1 });

    await user.click(screen.getByRole('button', { name: 'Edit PSA 9' }));
    const dialog = await screen.findByRole('dialog', { name: /edit graded copy/i });
    expect(within(dialog).getByLabelText('Grade')).toHaveValue('9');
    expect(within(dialog).getByRole('checkbox', { name: /counts towards set/i })).not.toBeChecked();
    await user.selectOptions(within(dialog).getByLabelText('Grade'), '8');
    await user.click(within(dialog).getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(store().graded.get('a')?.grade).toBe('8'));
    expect(store().graded.get('a')?.label).toBe('Gem Mint'); // edited label isn't overwritten

    await user.click(screen.getByRole('button', { name: 'Remove PSA 8' }));
    await waitFor(() => expect(store().graded.has('a')).toBe(false));
    const undo = useToasts.getState().toasts.find((t) => /Removed PSA 8/.test(t.message))!;
    await undo.action!.run();
    expect(store().graded.has('a')).toBe(true);
  });

  it('records what was paid for a slab and shows gain against its valuation', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GradedSection card={card} />);
    const dialog = await openForm(user);
    await user.type(within(dialog).getByLabelText(/your valuation/i), '100');
    await user.type(within(dialog).getByLabelText(/you paid/i), '£80');
    await user.click(within(dialog).getByRole('button', { name: /^add graded copy$/i }));
    await waitFor(() => expect(store().graded.size).toBe(1));
    expect([...store().graded.values()][0].paid).toEqual({ amount: 80, currency: 'GBP' });
    expect(await screen.findByText(/\+£20\.00/)).toHaveTextContent('+£20.00(+25%)');
  });

});
