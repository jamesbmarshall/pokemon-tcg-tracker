import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ShareDialog, { ShareButton } from './ShareDialog';
import { renderWithProviders } from '../test/render';
import { mockApi } from '../test/apiMock';
import { resetStores, seedCollection } from '../test/ui-helpers';
import { useCollectionStore } from '../store/collectionStore';
import type { Share } from '../api/sharing';

const share = (over: Partial<Share> = {}): Share => ({
  id: 'sh1',
  collectionId: 'c-personal',
  collectionName: 'My collection',
  scope: 'set',
  target: 'sv03',
  audience: 'public',
  title: null,
  hidePaid: true,
  hideValue: false,
  hideNotes: true,
  createdAt: '2025-01-01T00:00:00Z',
  expiresAt: null,
  revokedAt: null,
  active: true,
  views: 4,
  lastViewedAt: null,
  users: [],
  url: 'https://cards.example/s/tok1',
  ...over,
});

beforeEach(async () => {
  await resetStores();
  seedCollection();
});

describe('ShareButton', () => {
  it('is only offered to the collection owner', () => {
    const { unmount } = renderWithProviders(<ShareButton scope="wishlist" what="your wishlist" />);
    expect(screen.getByRole('button', { name: 'Share your wishlist' })).toBeInTheDocument();
    unmount();

    useCollectionStore.setState({ role: 'editor' });
    const second = renderWithProviders(<ShareButton scope="wishlist" what="your wishlist" />);
    expect(screen.queryByRole('button', { name: /Share/ })).not.toBeInTheDocument();
    second.unmount();

    useCollectionStore.setState({ role: 'owner', readOnly: true });
    renderWithProviders(<ShareButton scope="wishlist" what="your wishlist" />);
    expect(screen.queryByRole('button', { name: /Share/ })).not.toBeInTheDocument();
  });

  it('opens the dialog', async () => {
    mockApi({ 'GET /api/shares': [] });
    renderWithProviders(<ShareButton scope="wishlist" what="your wishlist" />);
    await userEvent.click(screen.getByRole('button', { name: 'Share your wishlist' }));
    expect(screen.getByRole('dialog', { name: 'Share your wishlist' })).toBeInTheDocument();
  });
});

describe('ShareDialog', () => {
  it('creates a public link with private details hidden by default, then lists it', async () => {
    const made: Share[] = [];
    const api = mockApi({
      'GET /api/shares': () => made,
      'POST /api/shares': (body: unknown) => {
        const s = share({ ...(body as Partial<Share>) });
        made.push(s);
        return s;
      },
    });
    renderWithProviders(<ShareDialog scope="set" target="sv03" what="Obsidian Flames" onClose={() => {}} />);

    expect(screen.getByRole('radio', { name: 'Anyone with link' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('checkbox', { name: /Hide what I paid/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Hide market values/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Hide notes/ })).toBeChecked();

    await userEvent.click(screen.getByRole('checkbox', { name: /Hide market values/ }));
    await userEvent.selectOptions(screen.getByLabelText('Expires'), '7');
    await userEvent.type(screen.getByLabelText(/Title/), 'My Flames');
    await userEvent.click(screen.getByRole('button', { name: /Create link/ }));

    await waitFor(() => expect(api.called('POST /api/shares')).toHaveLength(1));
    expect(api.calls.find((c) => c.method === 'POST')!.body).toEqual({
      collectionId: 'c-personal',
      scope: 'set',
      target: 'sv03',
      audience: 'public',
      title: 'My Flames',
      hidePaid: true,
      hideValue: true,
      hideNotes: true,
      expiresInDays: 7,
    });
    expect(await screen.findByRole('textbox', { name: 'Share link' })).toHaveValue('https://cards.example/s/tok1');
    expect(screen.getByText(/Hides what you paid, values, notes/)).toBeInTheDocument();
  });

  it('only lists links for the same thing', async () => {
    mockApi({
      'GET /api/shares': [share({ id: 'a', url: 'https://x/s/a' }), share({ id: 'b', target: 'sv04', url: 'https://x/s/b' }), share({ id: 'c', scope: 'wishlist', target: null, url: 'https://x/s/c' })],
    });
    renderWithProviders(<ShareDialog scope="set" target="sv03" what="Obsidian Flames" onClose={() => {}} />);
    expect(await screen.findByDisplayValue('https://x/s/a')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('https://x/s/b')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('https://x/s/c')).not.toBeInTheDocument();
  });

  it('shares with specific people, excluding yourself, and insists on at least one', async () => {
    const api = mockApi({
      'GET /api/shares': [],
      'GET /api/users': [
        { id: 'u-owner', username: 'ash', displayName: 'Ash' },
        { id: 'u2', username: 'misty', displayName: 'Misty' },
      ],
      'POST /api/shares': (body: unknown) => share(body as Partial<Share>),
    });
    renderWithProviders(<ShareDialog scope="wishlist" what="your wishlist" onClose={() => {}} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Specific people' }));
    await screen.findByRole('checkbox', { name: /Misty/ });
    expect(screen.queryByRole('checkbox', { name: /^Ash/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Create link/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('Pick at least one person');
    expect(api.called('POST /api/shares')).toHaveLength(0);

    await userEvent.click(screen.getByRole('checkbox', { name: /Misty/ }));
    await userEvent.click(screen.getByRole('button', { name: /Create link/ }));
    await waitFor(() => expect(api.called('POST /api/shares')).toHaveLength(1));
    expect(api.calls.find((c) => c.method === 'POST')!.body).toMatchObject({ audience: 'users', userIds: ['u2'], scope: 'wishlist' });
  });

  it('shows server errors', async () => {
    const { reply } = await import('../test/apiMock');
    mockApi({ 'GET /api/shares': [], 'POST /api/shares': reply(400, { error: 'You have too many share links' }) });
    renderWithProviders(<ShareDialog scope="collection" what="your collection" onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /Create link/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You have too many share links');
  });

  it('revokes and deletes links', async () => {
    let rows = [share()];
    const api = mockApi({
      'GET /api/shares': () => rows,
      'POST /api/shares/sh1/revoke': () => {
        rows = [share({ active: false, revokedAt: '2025-02-01T00:00:00Z' })];
        return { ok: true };
      },
      'DELETE /api/shares/sh1': () => {
        rows = [];
        return { ok: true };
      },
    });
    renderWithProviders(<ShareDialog scope="set" target="sv03" what="Obsidian Flames" onClose={() => {}} />);
    const section = (await screen.findByRole('heading', { name: 'Links for Obsidian Flames' })).closest('section')!;
    expect(within(section).getByText('Active')).toBeInTheDocument();
    await userEvent.click(within(section).getByRole('button', { name: /Revoke/ }));
    expect(await within(section).findByText('Revoked')).toBeInTheDocument();
    expect(within(section).queryByRole('textbox', { name: 'Share link' })).not.toBeInTheDocument();
    expect(api.called('POST /api/shares/sh1/revoke')).toHaveLength(1);

    await userEvent.click(within(section).getByRole('button', { name: 'Delete link' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Links for Obsidian Flames' })).not.toBeInTheDocument());
  });
});
