import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsPage from './SettingsPage';
import { renderWithProviders } from '../test/render';
import { resetStores, seedCollection } from '../test/ui-helpers';
import { makeEntry, makeGraded, makeSnapshot } from '../test/fixtures';
import { useCollectionStore } from '../store/collectionStore';
import { useSettings } from '../store/settingsStore';
import { useToasts } from '../store/toastStore';
import { useAuth } from '../store/authStore';
import { TEST_USER } from '../test/setup';
import { mockApi } from '../test/apiMock';

interface Download {
  name: string;
  blob: Blob;
}

function captureDownloads() {
  const downloads: Download[] = [];
  const blobs: Blob[] = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
    blobs.push(b as Blob);
    return `blob:${blobs.length}`;
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ name: this.download, blob: blobs[Number(this.href.split(':')[1]) - 1] });
  });
  return downloads;
}

const toasts = () => useToasts.getState().toasts;
const backupText = () => screen.getByText(/Your collection is stored on your PokéTracker server/).textContent;

beforeEach(async () => {
  vi.clearAllMocks();
  await resetStores();
  seedCollection({
    entries: [
      makeEntry({ quantity: 2, addedAt: '2025-01-02T10:00:00.000Z' }),
      makeEntry({ variant: 'reverseHolofoil', condition: 'LP' }),
      makeEntry({ cardId: 'odd-1', addedAt: '2025-01-03T00:00:00.000Z' }),
    ],
    cards: [makeSnapshot(), makeSnapshot({ id: 'odd-1', name: 'Mr. "Mime", Jr', prices: {} })],
    wishlist: [{ cardId: 'sv03-009', addedAt: '2025-01-01' }],
  });
});

describe('SettingsPage', () => {
  it('stacks each Section heading/control pair on narrow screens (regression: md:-only grid overflowed below 768px)', () => {
    renderWithProviders(<SettingsPage />);
    const grids = Array.from(document.querySelectorAll('.grid')).filter((el) => /\bmd:grid-cols-/.test(el.className));
    expect(grids.length).toBeGreaterThan(0);
    for (const grid of grids) {
      expect(grid.className).toMatch(/\bgrid-cols-1\b/);
    }
  });

  it('switches the theme from the Appearance section', async () => {
    renderWithProviders(<SettingsPage />);
    expect(screen.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(useSettings.getState().theme).toBe('dark');
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
  });

  it('switches currency and shows the conversion rate', async () => {
    renderWithProviders(<SettingsPage />);
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '£ GBP' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('$1 = 0.5000 GBP')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: '€ EUR' }));
    expect(useSettings.getState().currency).toBe('EUR');
    expect(screen.getByText('$1 = 0.9000 EUR')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: '$ USD' }));
    expect(screen.queryByText(/^\$1 =/)).not.toBeInTheDocument();
  });

  it('switches binder pocket size', async () => {
    renderWithProviders(<SettingsPage />);
    await userEvent.click(screen.getByRole('radio', { name: '12-pocket (4×3)' }));
    expect(useSettings.getState().pocketSize).toBe(12);
    expect(screen.getByRole('radio', { name: '12-pocket (4×3)' })).toHaveAttribute('aria-checked', 'true');
  });

  it('summarises sync status and collection size', () => {
    useCollectionStore.setState({ history: [{ date: '2025-01-01', valueUsd: 1, cards: 1, unique: 1 }] });
    renderWithProviders(<SettingsPage />);
    expect(screen.getByText('Not refreshed yet · 1 day of history')).toBeInTheDocument();
    // 2 × $1 + 1 × $2 = $4 → £2.00
    expect(backupText()).toContain('Current total: 3 entries, £2.00.');
  });

  it('shows the last sync time', () => {
    useCollectionStore.setState({ lastSync: new Date(Date.now() - 5 * 60_000).toISOString() });
    renderWithProviders(<SettingsPage />);
    expect(screen.getByText(/^Last refreshed .+ · 0 days of history$/)).toBeInTheDocument();
  });

  it('refreshes prices and reports the count', async () => {
    const syncPrices = vi.fn(async () => 3);
    useCollectionStore.setState({ syncPrices });
    renderWithProviders(<SettingsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
    expect(syncPrices).toHaveBeenCalledWith(true);
    await waitFor(() => expect(toasts()[0]).toMatchObject({ message: 'Prices up to date for 3 cards', tone: 'success' }));
  });

  it('uses the singular for one refreshed card', async () => {
    useCollectionStore.setState({ syncPrices: vi.fn(async () => 1) });
    renderWithProviders(<SettingsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
    await waitFor(() => expect(toasts()[0].message).toBe('Prices up to date for 1 card'));
  });

  it('reports a failed refresh', async () => {
    useCollectionStore.setState({ syncPrices: vi.fn(async () => -1) });
    renderWithProviders(<SettingsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
    await waitFor(() => expect(toasts()[0]).toMatchObject({ message: "Couldn't refresh prices. Try again in a minute.", tone: 'error' }));
  });

  it('disables refresh while syncing', () => {
    useCollectionStore.setState({ syncing: true });
    renderWithProviders(<SettingsPage />);
    expect(screen.getByRole('button', { name: 'Refreshing…' })).toBeDisabled();
  });

  it('exports a JSON backup of collection and wishlist', async () => {
    const downloads = captureDownloads();
    renderWithProviders(<SettingsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Export JSON' }));
    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toMatch(/^poketracker-\d{4}-\d{2}-\d{2}\.json$/);
    expect(downloads[0].blob.type).toBe('application/json');
    const data = JSON.parse(await downloads[0].blob.text());
    expect(data).toMatchObject({ app: 'poketracker', version: 4, wishlist: [{ cardId: 'sv03-009' }] });
    expect(data.collection).toHaveLength(3);
    expect(data).toMatchObject({ history: [], lists: [] });
  });

  it('exports CSV with converted prices and escaped cells', async () => {
    const downloads = captureDownloads();
    renderWithProviders(<SettingsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(downloads[0].name).toMatch(/\.csv$/);
    expect(downloads[0].blob.type).toBe('text/csv');
    expect((await downloads[0].blob.text()).split('\n')).toEqual([
      'Card ID,Name,Set,Number,Rarity,Variant,Quantity,Condition,Market (GBP) each,Added,Grade,Cert,Counts towards set,Paid (each),Paid currency,Notes',
      'sv03-001,Charmander,Obsidian Flames,1,Common,Normal,2,NM,0.50,2025-01-02,,,,,,',
      'sv03-001,Charmander,Obsidian Flames,1,Common,Reverse Holo,1,LP,1.00,2025-01-01,,,,,,',
      'odd-1,"Mr. ""Mime"", Jr",Obsidian Flames,1,Common,Normal,1,NM,,2025-01-03,,,,,,',
    ]);
  });

  it('disables exports when there is nothing to export', () => {
    seedCollection();
    renderWithProviders(<SettingsPage />);
    expect(screen.getByRole('button', { name: 'Export JSON' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
  });

  it('allows a JSON export of just a wishlist', () => {
    seedCollection({ wishlist: [{ cardId: 'sv03-009', addedAt: '2025-01-01' }] });
    renderWithProviders(<SettingsPage />);
    expect(screen.getByRole('button', { name: 'Export JSON' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
  });

  it('opens the file picker from Import JSON', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click');
    renderWithProviders(<SettingsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Import JSON' }));
    expect(click).toHaveBeenCalled();
  });

  it('imports a JSON file and resets the input', async () => {
    const importData = vi.fn(async () => 7);
    useCollectionStore.setState({ importData });
    const { container } = renderWithProviders(<SettingsPage />);
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    await userEvent.upload(input, new File(['{"collection":[]}'], 'backup.json', { type: 'application/json' }));
    await waitFor(() => expect(toasts()[0]).toMatchObject({ message: 'Imported 7 entries', tone: 'success' }));
    expect(importData).toHaveBeenCalledWith({ collection: [] });
    expect(input.value).toBe('');
  });

  it('reports invalid import files', async () => {
    const { container } = renderWithProviders(<SettingsPage />);
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    await userEvent.upload(input, new File(['{}'], 'empty.json', { type: 'application/json' }));
    await waitFor(() => expect(toasts()[0]).toMatchObject({ message: 'Import failed: No collection entries found in file', tone: 'error' }));
  });

  it('reports unparseable import files', async () => {
    const importData = vi.fn();
    useCollectionStore.setState({ importData });
    const { container } = renderWithProviders(<SettingsPage />);
    await userEvent.upload(container.querySelector('input[type=file]') as HTMLInputElement, new File(['not json'], 'x.json', { type: 'application/json' }));
    await waitFor(() => expect(toasts()[0].message).toMatch(/^Import failed: /));
    expect(importData).not.toHaveBeenCalled();
  });

  it('ignores an empty file selection', () => {
    const importData = vi.fn();
    useCollectionStore.setState({ importData });
    const { container } = renderWithProviders(<SettingsPage />);
    fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [] } });
    expect(importData).not.toHaveBeenCalled();
    expect(toasts()).toHaveLength(0);
  });

  it('describes the server-side image cache', () => {
    renderWithProviders(<SettingsPage />);
    expect(screen.getByText(/Your server keeps its own copy of every owned and wishlisted card/)).toBeInTheDocument();
  });

  it('hides import and the danger zone from viewers', () => {
    useCollectionStore.setState({ readOnly: true, role: 'viewer' });
    const { container } = renderWithProviders(<SettingsPage />);
    expect(screen.getByRole('button', { name: 'Export JSON' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import JSON' })).not.toBeInTheDocument();
    expect(container.querySelector('input[type=file]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear everything' })).not.toBeInTheDocument();
  });

  it('keeps import but hides the danger zone for editors', () => {
    useCollectionStore.setState({ readOnly: false, role: 'editor' });
    renderWithProviders(<SettingsPage />);
    expect(screen.getByRole('button', { name: 'Import JSON' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear everything' })).not.toBeInTheDocument();
  });

  it('wraps the danger-zone confirm row instead of letting the button overflow the viewport', () => {
    // Regression test: the "delete" input + "Clear everything" button sat in a non-wrapping
    // flex row, which overflowed a 320px viewport by 10px. flex-wrap lets the button drop to
    // its own line instead of being clipped off-screen.
    renderWithProviders(<SettingsPage />);
    const button = screen.getByRole('button', { name: 'Clear everything' });
    const row = button.closest('div[class*="flex"]')!;
    expect(row.className).toContain('flex-wrap');
  });

  it('requires typing "delete", then backs up and clears everything', async () => {
    const downloads = captureDownloads();
    renderWithProviders(<SettingsPage />);
    const button = screen.getByRole('button', { name: 'Clear everything' });
    const input = screen.getByText('delete').closest('div')!.querySelector('input')!;
    expect(button).toBeDisabled();
    await userEvent.type(input, 'delet');
    expect(button).toBeDisabled();
    await userEvent.type(input, 'e');
    expect(button).toBeEnabled();
    await userEvent.click(button);

    await waitFor(() => expect(toasts()[0].message).toBe('Collection cleared. A backup was downloaded first.'));
    expect(downloads).toHaveLength(1);
    expect(JSON.parse(await downloads[0].blob.text()).collection).toHaveLength(3);
    const state = useCollectionStore.getState();
    expect(state.entries.size).toBe(0);
    expect(state.wishlist.size).toBe(0);
    expect(input).toHaveValue('');
    expect(button).toBeDisabled();
    expect(backupText()).toContain('Current total: 0 entries');
  });
  it('includes card notes in JSON and CSV exports', async () => {
    seedCollection({ entries: [makeEntry()], cards: [makeSnapshot()], notes: { 'sv03-001': 'Card fair, Birmingham, "£3"' } });
    const downloads = captureDownloads();
    renderWithProviders(<SettingsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Export JSON' }));
    expect(JSON.parse(await downloads[0].blob.text()).notes).toEqual([{ cardId: 'sv03-001', text: 'Card fair, Birmingham, "£3"' }]);
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect((await downloads[1].blob.text()).split('\n')[1]).toMatch(/,"Card fair, Birmingham, ""£3"""$/);
  });

  it('allows a JSON export of just notes', () => {
    seedCollection({ notes: { 'sv03-001': 'Want this one' } });
    renderWithProviders(<SettingsPage />);
    expect(screen.getByRole('button', { name: 'Export JSON' })).toBeEnabled();
  });

  it('exports purchase prices for raw copies and slabs in their own currency', async () => {
    seedCollection({
      entries: [makeEntry({ paid: { amount: 0.4, currency: 'EUR' } })],
      graded: [makeGraded({ paid: { amount: 120, currency: 'GBP' } })],
      cards: [makeSnapshot()],
    });
    const downloads = captureDownloads();
    renderWithProviders(<SettingsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    const rows = (await downloads[0].blob.text()).split('\n');
    expect(rows[1]).toMatch(/,0\.40,EUR,$/);
    expect(rows[2]).toMatch(/,120\.00,GBP,$/);
  });

});

describe('server and updates', () => {
  const update = { current: '1.2.0', launcherVersion: '1', canUpdate: true, blocker: null, autoUpdate: false, available: false, latest: null, checkedAt: null, error: null, applying: false, progress: null, launcher: {} };

  it('gives the owner the update controls and the admin area', async () => {
    mockApi({ 'GET /api/system/update': update });
    renderWithProviders(<SettingsPage />);
    expect(screen.getByRole('heading', { name: 'Updates' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /check now/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /users, invites/i })).toHaveAttribute('href', '/admin');
    expect(await screen.findByText('test')).toBeInTheDocument();
  });

  it('gives admins the admin area but not updates', () => {
    useAuth.setState({ user: { ...TEST_USER, role: 'admin' } });
    renderWithProviders(<SettingsPage />);
    expect(screen.queryByRole('heading', { name: 'Updates' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /users, invites/i })).toBeInTheDocument();
  });

  it('shows members the version only', () => {
    useAuth.setState({ user: { ...TEST_USER, role: 'member' } });
    renderWithProviders(<SettingsPage />);
    expect(screen.getByRole('heading', { name: 'Server' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Updates' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /users, invites/i })).not.toBeInTheDocument();
  });
});
