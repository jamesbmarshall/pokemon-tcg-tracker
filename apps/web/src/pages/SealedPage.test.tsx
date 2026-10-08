import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SealedPage from './SealedPage';
import { renderWithProviders } from '../test/render';
import { resetStores, seedCollection } from '../test/ui-helpers';
import { makeSealed } from '../test/fixtures';
import { useCollectionStore } from '../store/collectionStore';
import { useToasts } from '../store/toastStore';
import { memory } from '../test/memoryBackend';

const toasts = () => useToasts.getState().toasts;

beforeEach(async () => {
  vi.clearAllMocks();
  await resetStores();
});

describe('SealedPage', () => {
  it('shows an empty state with an add action', () => {
    seedCollection();
    renderWithProviders(<SealedPage />);
    expect(screen.getByRole('heading', { name: 'No sealed products yet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add sealed product' })).toBeInTheDocument();
  });

  it('lists seeded sealed items with type, quantity, value and status', () => {
    seedCollection({ sealed: [makeSealed({ valueUsd: 100 }), makeSealed({ id: 'sealed-2', name: 'Paldea ETB', productType: 'etb', quantity: 2, status: 'opened' })] });
    renderWithProviders(<SealedPage />);
    expect(screen.getByText('Obsidian Flames booster box')).toBeInTheDocument();
    expect(screen.getByText(/Booster box · ×1/)).toBeInTheDocument();
    expect(screen.getByText('£50.00')).toBeInTheDocument();
    expect(screen.getByText('Sealed')).toBeInTheDocument();
    expect(screen.getByText('Paldea ETB')).toBeInTheDocument();
    expect(screen.getByText(/Elite Trainer Box · ×2/)).toBeInTheDocument();
    expect(screen.getByText('Opened')).toBeInTheDocument();
  });

  it('adds a new sealed item via the dialog', async () => {
    seedCollection();
    renderWithProviders(<SealedPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Add sealed product' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Scarlet & Violet booster box');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add sealed product' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Scarlet & Violet booster box')).toBeInTheDocument();
    const saved = [...useCollectionStore.getState().sealed.values()].find((s) => s.name === 'Scarlet & Violet booster box');
    expect(saved).toBeTruthy();
    expect(saved?.quantity).toBe(1);
    expect(saved?.productType).toBe('booster_box');
  });

  it('edits an existing item', async () => {
    seedCollection({ sealed: [makeSealed()] });
    renderWithProviders(<SealedPage />);
    await userEvent.click(screen.getByRole('button', { name: /Edit Obsidian Flames booster box/ }));
    const dialog = await screen.findByRole('dialog');
    const nameInput = within(dialog).getByLabelText('Name') as HTMLInputElement;
    expect(nameInput.value).toBe('Obsidian Flames booster box');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Obsidian Flames booster box (sealed)');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Obsidian Flames booster box (sealed)')).toBeInTheDocument();
  });

  it('removes an item with undo', async () => {
    seedCollection({ sealed: [makeSealed()] });
    renderWithProviders(<SealedPage />);
    await userEvent.click(screen.getByRole('button', { name: /Remove Obsidian Flames booster box/ }));
    await waitFor(() => expect(screen.queryByText('Obsidian Flames booster box')).not.toBeInTheDocument());
    await waitFor(() => expect(toasts()[0]?.message).toBe('Removed Obsidian Flames booster box'));
    toasts()[0].action!.run();
    expect(await screen.findByText('Obsidian Flames booster box')).toBeInTheDocument();
  });

  it('marks an item opened via a confirm step', async () => {
    seedCollection({ sealed: [makeSealed()] });
    memory.sealed.set('sealed-1', makeSealed());
    renderWithProviders(<SealedPage />);
    await userEvent.click(screen.getByRole('button', { name: /Mark Obsidian Flames booster box opened/ }));
    const confirmDialog = await screen.findByRole('dialog', { name: 'Mark opened?' });
    await userEvent.click(within(confirmDialog).getByRole('button', { name: 'Mark opened' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Opened')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mark Obsidian Flames booster box opened/ })).not.toBeInTheDocument();
    expect(useCollectionStore.getState().sealed.get('sealed-1')?.status).toBe('opened');
  });

  it('searches and links a PriceCharting product when configured', async () => {
    memory.pricechartingConfigured = true;
    memory.pcResults = [{ id: 'pc-1', name: 'Obsidian Flames Booster Box', consoleName: 'Pokemon' }];
    seedCollection({ sealed: [makeSealed()] });
    renderWithProviders(<SealedPage />);
    await userEvent.click(screen.getByRole('button', { name: /Edit Obsidian Flames booster box/ }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Obsidian Flames Booster Box')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByText('Obsidian Flames Booster Box'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(useCollectionStore.getState().sealed.get('sealed-1')?.pcProductId).toBe('pc-1');
  });

  it('offers no add, edit, remove or mark-opened controls when read-only', () => {
    seedCollection({ sealed: [makeSealed()] });
    useCollectionStore.setState({ readOnly: true, role: 'viewer' });
    renderWithProviders(<SealedPage />);
    expect(screen.queryByRole('button', { name: /Add sealed product|Edit|Remove|Mark .* opened/ })).not.toBeInTheDocument();
  });
});
