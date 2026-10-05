import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SharingPage from './SharingPage';
import { renderWithProviders } from '../test/render';
import { mockApi } from '../test/apiMock';
import { resetStores, seedCollection } from '../test/ui-helpers';
import { useCollectionStore } from '../store/collectionStore';
import type { CollectionSummary } from '../api/backend';
import type { Share } from '../api/sharing';

const PERSONAL: CollectionSummary = { id: 'c-personal', name: 'My collection', kind: 'personal', role: 'owner', ownerName: 'Ash', mine: true };
const FAMILY: CollectionSummary = { id: 'c-fam', name: 'Family binder', kind: 'shared', role: 'owner', ownerName: 'Ash', mine: true };
const GYM: CollectionSummary = { id: 'c-gym', name: 'Gym stash', kind: 'shared', role: 'editor', ownerName: 'Brock', mine: false };

const share = (over: Partial<Share> = {}): Share => ({
  id: 'sh1',
  collectionId: 'c-personal',
  collectionName: 'My collection',
  scope: 'wishlist',
  target: null,
  audience: 'public',
  title: null,
  hidePaid: true,
  hideValue: false,
  hideNotes: true,
  createdAt: '2025-01-01T00:00:00Z',
  expiresAt: null,
  revokedAt: null,
  active: true,
  views: 0,
  lastViewedAt: null,
  users: [],
  url: 'https://cards.example/s/tok1',
  ...over,
});

const load = vi.fn(async () => {});

function setup(routes: Parameters<typeof mockApi>[0] = {}) {
  const api = mockApi({ 'GET /api/shares': [], 'GET /api/shared-with-me': [], ...routes });
  renderWithProviders(<SharingPage />);
  return api;
}

const row = (name: string) => screen.getByText(name, { selector: 'p, p *' }).closest('li')!;

beforeEach(async () => {
  load.mockClear();
  await resetStores();
  seedCollection();
  useCollectionStore.setState({ collections: [PERSONAL, FAMILY, GYM], load });
});

describe('SharingPage collections', () => {
  it('lists collections with the actions each one allows', () => {
    setup();
    expect(within(row('My collection')).getByText('Open')).toBeInTheDocument();
    expect(within(row('My collection')).queryByRole('button', { name: /People|Rename|Delete|Leave/ })).not.toBeInTheDocument();
    expect(within(row('Family binder')).getByRole('button', { name: 'Rename Family binder' })).toBeInTheDocument();
    expect(within(row('Family binder')).getByRole('button', { name: 'Delete Family binder' })).toBeInTheDocument();
    expect(within(row('Gym stash')).getByText(/Brock's/)).toBeInTheDocument();
    expect(within(row('Gym stash')).getByRole('button', { name: 'Leave Gym stash' })).toBeInTheDocument();
    expect(within(row('Gym stash')).queryByRole('button', { name: /Rename|Delete/ })).not.toBeInTheDocument();
  });

  it('switches to another collection', async () => {
    setup();
    await userEvent.click(within(row('Gym stash')).getByRole('button', { name: 'Open' }));
    expect(load).toHaveBeenCalledWith('c-gym');
  });

  it('creates a shared collection and opens it', async () => {
    const api = setup({ 'POST /api/collections': { ...FAMILY, id: 'c-new', name: 'Trades' } });
    await userEvent.click(screen.getByRole('button', { name: /New shared collection/ }));
    const dialog = screen.getByRole('dialog', { name: 'New shared collection' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Trades');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(load).toHaveBeenCalledWith('c-new'));
    expect(api.called('POST /api/collections')[0].body).toEqual({ name: 'Trades' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('deletes a shared collection after confirming', async () => {
    const api = setup({ 'DELETE /api/collections/c-fam': { ok: true } });
    await userEvent.click(screen.getByRole('button', { name: 'Delete Family binder' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Delete Family binder?' })).getByRole('button', { name: 'Delete collection' }));
    await waitFor(() => expect(api.called('DELETE /api/collections/c-fam')).toHaveLength(1));
    expect(load).toHaveBeenCalledWith('c-personal');
  });

  it('leaves a collection someone else owns', async () => {
    const api = setup({ 'DELETE /api/collections/c-gym/members/u-owner': { ok: true } });
    await userEvent.click(screen.getByRole('button', { name: 'Leave Gym stash' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Leave Gym stash?' })).getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(api.called('DELETE /api/collections/c-gym/members/u-owner')).toHaveLength(1));
  });

  it('manages members of an owned shared collection', async () => {
    let members: { id: string; username: string; displayName: string; role: 'editor' | 'viewer' }[] = [{ id: 'u2', username: 'misty', displayName: 'Misty', role: 'viewer' }];
    const api = setup({
      'GET /api/collections/c-fam/members': () => members,
      'GET /api/users': [
        { id: 'u-owner', username: 'ash', displayName: 'Ash' },
        { id: 'u2', username: 'misty', displayName: 'Misty' },
        { id: 'u3', username: 'brock', displayName: 'Brock' },
      ],
      'PUT /api/collections/c-fam/members/u2': (body: unknown) => {
        members = [{ ...members[0], role: (body as { role: 'editor' }).role }];
        return { ok: true };
      },
      'PUT /api/collections/c-fam/members/u3': () => {
        members = [...members, { id: 'u3', username: 'brock', displayName: 'Brock', role: 'viewer' }];
        return { ok: true };
      },
      'DELETE /api/collections/c-fam/members/u2': () => {
        members = members.filter((m) => m.id !== 'u2');
        return { ok: true };
      },
    });
    await userEvent.click(screen.getByRole('button', { name: 'People in Family binder' }));
    const dialog = screen.getByRole('dialog', { name: 'People in Family binder' });
    const access = await within(dialog).findByRole('combobox', { name: "Misty's access" });
    expect(access).toHaveValue('viewer');

    // Only people not already in are offered, and never yourself
    const picker = within(dialog).getByRole('combobox', { name: 'Person to add' });
    await waitFor(() => expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual(['Add someone…', 'Brock (brock)']));

    await userEvent.selectOptions(access, 'editor');
    await waitFor(() => expect(api.called('PUT /api/collections/c-fam/members/u2')[0].body).toEqual({ role: 'editor' }));

    await userEvent.selectOptions(picker, 'u3');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Can view' }));
    await userEvent.click(within(dialog).getByRole('button', { name: /^Add$/ }));
    await waitFor(() => expect(api.called('PUT /api/collections/c-fam/members/u3')[0].body).toEqual({ role: 'viewer' }));
    expect(await within(dialog).findByRole('combobox', { name: "Brock's access" })).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove Misty' }));
    await waitFor(() => expect(within(dialog).queryByRole('combobox', { name: "Misty's access" })).not.toBeInTheDocument());
  });

  it('shows members read-only to non-owners', async () => {
    useCollectionStore.setState({ collections: [PERSONAL, { ...GYM }] });
    setup({ 'GET /api/collections/c-gym/members': [{ id: 'u-owner', username: 'ash', displayName: 'Ash', role: 'editor' }], 'GET /api/users': [] });
    await userEvent.click(screen.getByRole('button', { name: 'People in Gym stash' }));
    const dialog = screen.getByRole('dialog', { name: 'People in Gym stash' });
    expect(await within(dialog).findByText('Ash')).toBeInTheDocument();
    expect(within(dialog).getByText('Brock')).toBeInTheDocument();
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Remove|Add/ })).not.toBeInTheDocument();
  });
});

describe('SharingPage links', () => {
  it('lists things shared with you, linking to the share page', async () => {
    setup({ 'GET /api/shared-with-me': [share({ id: 'x', scope: 'collection', ownerName: 'Misty', url: 'https://cards.example/s/abc' } as Partial<Share>)] });
    const view = await screen.findByRole('link', { name: /View/ });
    expect(view).toHaveAttribute('href', '/s/abc');
    expect(screen.getByText("Misty's collection")).toBeInTheDocument();
  });

  it('lists your live links and tucks away dead ones', async () => {
    setup({
      'GET /api/shares': [share(), share({ id: 'old', active: false, revokedAt: '2025-02-01T00:00:00Z', url: 'https://cards.example/s/old' })],
    });
    expect(await screen.findByDisplayValue('https://cards.example/s/tok1')).toBeInTheDocument();
    expect(screen.queryByText('Revoked')).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Show 1 expired or revoked link' });
    await userEvent.click(toggle);
    expect(screen.getByText('Revoked')).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('says when nothing is shared yet', async () => {
    setup();
    expect(await screen.findByText("You haven't shared anything yet.")).toBeInTheDocument();
    expect(screen.getByText(/Nothing yet/)).toBeInTheDocument();
  });
});
