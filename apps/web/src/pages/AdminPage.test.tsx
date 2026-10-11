import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminPage, { type AdminUser, type Job } from './AdminPage';
import { bytes, fromNow } from '../utils/format';
import { useAuth, type User } from '../store/authStore';
import { renderWithProviders } from '../test/render';
import { mockApi, reply } from '../test/apiMock';

const owner: User = { id: 'u1', username: 'ash', displayName: 'Ash', role: 'owner', totpEnabled: false };
const admin: User = { id: 'u2', username: 'misty', displayName: 'Misty', role: 'admin', totpEnabled: false };
const member: User = { id: 'u3', username: 'brock', displayName: 'Brock', role: 'member', totpEnabled: false };
const row = (u: User, over: Partial<AdminUser> = {}): AdminUser => ({ ...u, disabled: false, locked: false, createdAt: '2025-01-01T00:00:00Z', lastLoginAt: null, ...over });
const users = [row(owner), row(admin), row(member, { locked: true, totpEnabled: true })];

const signIn = (u: User) => useAuth.setState({ status: 'ready', user: u });

beforeEach(() => signIn(owner));

it('sends members back to their collection', () => {
  signIn(member);
  mockApi({});
  renderWithProviders(<AdminPage />);
  expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
});

it('only shows backups to the owner', () => {
  mockApi({ 'GET /api/admin/users': users });
  const { unmount } = renderWithProviders(<AdminPage />);
  expect(screen.getByRole('radio', { name: 'Backups' })).toBeInTheDocument();
  unmount();
  signIn(admin);
  renderWithProviders(<AdminPage />);
  expect(screen.queryByRole('radio', { name: 'Backups' })).not.toBeInTheDocument();
});

describe('Users', () => {
  it('lets the owner manage everyone but themselves', async () => {
    mockApi({ 'GET /api/admin/users': users });
    renderWithProviders(<AdminPage />);
    expect(await screen.findByLabelText('Role for misty')).toHaveValue('admin');
    expect(screen.getByLabelText('Role for brock')).toHaveValue('member');
    expect(screen.queryByLabelText('Role for ash')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Delete ash')).not.toBeInTheDocument();
    expect(screen.getByText('Locked out')).toBeInTheDocument();
  });

  it('admins can manage members but not other admins or roles', async () => {
    signIn(admin);
    mockApi({ 'GET /api/admin/users': users });
    renderWithProviders(<AdminPage />);
    expect(await screen.findByLabelText('Delete brock')).toBeInTheDocument();
    expect(screen.queryByLabelText('Delete misty')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Role for brock')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /make owner/i })).not.toBeInTheDocument();
  });

  it('changes a role and unlocks', async () => {
    const user = userEvent.setup();
    const m = mockApi({ 'GET /api/admin/users': users, 'PATCH /api/admin/users/u3': {} });
    renderWithProviders(<AdminPage />);
    await user.selectOptions(await screen.findByLabelText('Role for brock'), 'admin');
    await user.click(screen.getByRole('button', { name: /unlock/i }));
    await waitFor(() => expect(m.called('PATCH /api/admin/users/u3').map((c) => c.body)).toEqual([{ role: 'admin' }, { unlock: true }]));
  });

  it('creates a reset link, optionally clearing 2FA', async () => {
    const user = userEvent.setup();
    const m = mockApi({ 'GET /api/admin/users': users, 'POST /api/admin/users/u3/reset': { link: 'https://poke.example/reset/abc' } });
    renderWithProviders(<AdminPage />);
    const brockRow = (await screen.findByLabelText('Role for brock')).closest('tr')!;
    await user.click(within(brockRow).getByRole('button', { name: /reset link/i }));
    await user.click(screen.getByRole('checkbox', { name: /also turn off two-factor/i }));
    await user.click(screen.getByRole('button', { name: /create link/i }));
    expect(await screen.findByDisplayValue('https://poke.example/reset/abc')).toBeInTheDocument();
    expect(m.called('POST /api/admin/users/u3/reset')[0].body).toEqual({ clearTotp: true });
  });

  it('deletes only after confirming', async () => {
    const user = userEvent.setup();
    const m = mockApi({ 'GET /api/admin/users': users, 'DELETE /api/admin/users/u3': {} });
    renderWithProviders(<AdminPage />);
    await user.click(await screen.findByLabelText('Delete brock'));
    expect(screen.getByText(/permanently deletes their account/)).toBeInTheDocument();
    expect(m.called('DELETE /api/admin/users/u3')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Delete user' }));
    await waitFor(() => expect(m.called('DELETE /api/admin/users/u3')).toHaveLength(1));
  });

  it('transfers ownership with the password and refreshes who I am', async () => {
    const user = userEvent.setup();
    const m = mockApi({
      'GET /api/admin/users': users,
      'POST /api/admin/users/u2/transfer-ownership': {},
      'GET /api/auth/me': { user: { ...owner, role: 'admin' } },
    });
    renderWithProviders(<AdminPage />);
    const mistyRow = (await screen.findByLabelText('Role for misty')).closest('tr')!;
    await user.click(within(mistyRow).getByRole('button', { name: /make owner/i }));
    await user.type(screen.getByLabelText('Your password'), 'correct horse');
    await user.click(screen.getByRole('button', { name: 'Transfer ownership' }));
    await waitFor(() => expect(useAuth.getState().user?.role).toBe('admin'));
    expect(m.called('POST /api/admin/users/u2/transfer-ownership')[0].body).toEqual({ password: 'correct horse' });
  });
});

describe('Invites', () => {
  it('creates an invite and shows the link once', async () => {
    const user = userEvent.setup();
    const m = mockApi({ 'GET /api/admin/users': users, 'GET /api/admin/invites': [], 'POST /api/admin/invites': { id: 'i1', link: 'https://poke.example/invite/xyz' } });
    renderWithProviders(<AdminPage />);
    await user.click(screen.getByRole('radio', { name: 'Invites' }));
    expect(await screen.findByText('No invites yet.')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Admin' }));
    await user.selectOptions(screen.getByLabelText('Expires after'), '3');
    await user.type(screen.getByLabelText('Note (optional)'), ' For Sam ');
    await user.click(screen.getByRole('button', { name: /create invite link/i }));
    expect(await screen.findByDisplayValue('https://poke.example/invite/xyz')).toBeInTheDocument();
    expect(m.called('POST /api/admin/invites')[0].body).toEqual({ role: 'admin', days: 3, note: 'For Sam' });
  });

  it('hides the role choice from admins', async () => {
    signIn(admin);
    const user = userEvent.setup();
    mockApi({ 'GET /api/admin/users': users, 'GET /api/admin/invites': [] });
    renderWithProviders(<AdminPage />);
    await user.click(screen.getByRole('radio', { name: 'Invites' }));
    expect(screen.queryByRole('radio', { name: 'Admin' })).not.toBeInTheDocument();
  });

  it('describes invite states and revokes open ones', async () => {
    const user = userEvent.setup();
    const base = { role: 'member' as const, note: null, createdAt: new Date().toISOString(), usedAt: null, revokedAt: null, createdBy: 'ash', usedBy: null };
    const future = new Date(Date.now() + 3 * 864e5).toISOString();
    const m = mockApi({
      'GET /api/admin/users': users,
      'GET /api/admin/invites': [
        { ...base, id: 'open', expiresAt: future },
        { ...base, id: 'used', expiresAt: future, usedAt: base.createdAt, usedBy: 'brock' },
        { ...base, id: 'old', expiresAt: '2020-01-01T00:00:00Z' },
      ],
      'DELETE /api/admin/invites/open': {},
    });
    renderWithProviders(<AdminPage />);
    await user.click(screen.getByRole('radio', { name: 'Invites' }));
    expect(await screen.findByText(/Open, expires in 3d/)).toBeInTheDocument();
    expect(screen.getByText('Used by brock')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
    const revoke = screen.getAllByRole('button', { name: 'Revoke' });
    expect(revoke).toHaveLength(1);
    await user.click(revoke[0]);
    await waitFor(() => expect(m.called('DELETE /api/admin/invites/open')).toHaveLength(1));
  });
});

describe('Jobs', () => {
  const job = (over: Partial<Job>): Job => ({ name: 'prices', label: 'Card prices', running: false, lastStartedAt: null, lastFinishedAt: null, lastStatus: null, lastError: null, nextRunAt: null, ...over });

  it('shows status, errors and runs a job', async () => {
    const user = userEvent.setup();
    const m = mockApi({
      'GET /api/admin/users': users,
      'GET /api/admin/jobs': [job({ lastStatus: 'error', lastError: 'TCGdex 503', lastFinishedAt: new Date().toISOString() }), job({ name: 'fx', label: 'Exchange rates', running: true })],
      'GET /api/admin/storage': { dbBytes: 5 * 1024 * 1024, images: { count: 1200, bytes: 300 * 1024 * 1024, capBytes: 2 * 1024 ** 3 }, backups: 4 },
      'POST /api/admin/jobs/prices/run': {},
    });
    renderWithProviders(<AdminPage />);
    await user.click(screen.getByRole('radio', { name: 'Jobs' }));
    expect(await screen.findByText('TCGdex 503')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(await screen.findByText('5.0 MB')).toBeInTheDocument();
    expect(screen.getByText(/limit 2\.0 GB/)).toBeInTheDocument();
    const runs = screen.getAllByRole('button', { name: /run now/i });
    expect(runs[1]).toBeDisabled();
    await user.click(runs[0]);
    await waitFor(() => expect(m.called('POST /api/admin/jobs/prices/run')).toHaveLength(1));
  });

  it('keeps the update check for the owner', async () => {
    signIn(admin);
    const user = userEvent.setup();
    mockApi({ 'GET /api/admin/users': users, 'GET /api/admin/jobs': [job({ name: 'update-check', label: 'Check for updates' })], 'GET /api/admin/storage': { dbBytes: 0, images: { count: 0, bytes: 0, capBytes: 0 }, backups: 0 } });
    renderWithProviders(<AdminPage />);
    await user.click(screen.getByRole('radio', { name: 'Jobs' }));
    expect(await screen.findByText('Check for updates')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /run now/i })).not.toBeInTheDocument();
  });

  it('shows provider health, including stale-served counts and an unreachable state', async () => {
    const user = userEvent.setup();
    mockApi({
      'GET /api/admin/users': users,
      'GET /api/admin/jobs': [job({})],
      'GET /api/admin/storage': { dbBytes: 0, images: { count: 0, bytes: 0, capBytes: 0 }, backups: 0 },
      'GET /api/admin/providers': {
        tcgdex: { name: 'tcgdex', state: 'open', consecutiveFailures: 5, lastSuccessAt: '2025-01-01T00:00:00Z', lastFailureAt: '2025-01-02T00:00:00Z', lastError: 'fetch failed', staleServedCount: 3, openedAt: '2025-01-02T00:00:00Z' },
        pricecharting: { name: 'pricecharting', state: 'closed', consecutiveFailures: 0, lastSuccessAt: null, lastFailureAt: null, lastError: null, staleServedCount: 0, openedAt: null, configured: false },
      },
    });
    renderWithProviders(<AdminPage />);
    await user.click(screen.getByRole('radio', { name: 'Jobs' }));
    expect(await screen.findByText('TCGdex (catalogue & prices)')).toBeInTheDocument();
    expect(screen.getByText('Unreachable')).toBeInTheDocument();
    expect(screen.getByText('fetch failed')).toBeInTheDocument();
    expect(screen.getByText('3 stale responses served')).toBeInTheDocument();
    expect(screen.getByText('PriceCharting (price fallback)')).toBeInTheDocument();
    expect(screen.getByText('Not set up')).toBeInTheDocument();
  });
});

it('backs up, links downloads and deletes a backup after confirming', async () => {
  const user = userEvent.setup();
  const name = 'poketracker-2025-06-01.db';
  const m = mockApi({
    'GET /api/admin/users': users,
    'GET /api/admin/backups': [{ name, size: 2048, createdAt: '2025-06-01T02:00:00Z', kind: 'pre-update' }],
    'POST /api/admin/backups': { name: 'manual.db' },
    [`DELETE /api/admin/backups/${name}`]: {},
  });
  renderWithProviders(<AdminPage />);
  await user.click(screen.getByRole('radio', { name: 'Backups' }));
  expect(await screen.findByText(/Before update/)).toHaveTextContent('2.0 KB');
  expect(screen.getByRole('link', { name: /download/i })).toHaveAttribute('href', `/api/admin/backups/${name}`);
  await user.click(screen.getByRole('button', { name: /back up now/i }));
  await waitFor(() => expect(m.called('POST /api/admin/backups')).toHaveLength(1));
  await user.click(screen.getByLabelText(`Delete ${name}`));
  await user.click(screen.getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(m.called(`DELETE /api/admin/backups/${name}`)).toHaveLength(1));
});

it('labels activity in plain English', async () => {
  const user = userEvent.setup();
  mockApi({
    'GET /api/admin/users': users,
    'GET /api/admin/audit': [
      { at: new Date().toISOString(), action: 'auth.login_failed', target: 'u3', ip: '203.0.113.9', username: null },
      { at: new Date().toISOString(), action: 'system.update_applied', target: '1.4.0', ip: null, username: null },
      { at: new Date().toISOString(), action: 'something.new', target: null, ip: null, username: 'ash' },
    ],
  });
  renderWithProviders(<AdminPage />);
  await user.click(screen.getByRole('radio', { name: 'Activity' }));
  expect(await screen.findByText('Failed sign-in')).toHaveClass('text-loss');
  expect(screen.getByText('Installed an update')).toHaveTextContent('1.4.0');
  expect(screen.getByText('something.new')).toBeInTheDocument();
});

it('formats sizes and countdowns', () => {
  expect(bytes(512)).toBe('512 B');
  expect(bytes(1536)).toBe('1.5 KB');
  expect(bytes(250 * 1024 * 1024)).toBe('250 MB');
  expect(fromNow(new Date(Date.now() - 1000).toISOString())).toBe('due now');
  expect(fromNow(new Date(Date.now() + 30 * 60000).toISOString())).toBe('in 30m');
  expect(fromNow(new Date(Date.now() + 5 * 3600000).toISOString())).toBe('in 5h');
  expect(fromNow(new Date(Date.now() + 4 * 864e5).toISOString())).toBe('in 4d');
});

describe('Integrations', () => {
  it('sets a PriceCharting key and shows it as configured', async () => {
    const user = userEvent.setup();
    const m = mockApi({
      'GET /api/admin/users': users,
      'GET /api/admin/integrations': { pricecharting: { configured: false } },
      'PUT /api/admin/integrations/pricecharting': { configured: true },
    });
    renderWithProviders(<AdminPage />);
    await user.click(screen.getByRole('radio', { name: 'Integrations' }));
    expect(await screen.findByText('Not set')).toBeInTheDocument();
    m.set('GET /api/admin/integrations', { pricecharting: { configured: true } });
    await user.type(screen.getByLabelText(/api key/i), 'a-pricecharting-key-1234');
    await user.click(screen.getByRole('button', { name: /save key/i }));
    await waitFor(() => expect(m.called('PUT /api/admin/integrations/pricecharting')).toHaveLength(1));
    expect(m.called('PUT /api/admin/integrations/pricecharting')[0].body).toEqual({ key: 'a-pricecharting-key-1234' });
    expect(await screen.findByText('Configured')).toBeInTheDocument();
    expect(screen.getByLabelText(/api key/i)).toHaveValue('');
  });

  it('tests the connection and surfaces a failure', async () => {
    const user = userEvent.setup();
    mockApi({
      'GET /api/admin/users': users,
      'GET /api/admin/integrations': { pricecharting: { configured: true } },
      'POST /api/admin/integrations/pricecharting/test': reply(502, { error: "Couldn't reach PriceCharting: network error" }),
    });
    renderWithProviders(<AdminPage />);
    await user.click(screen.getByRole('radio', { name: 'Integrations' }));
    expect(await screen.findByText('Configured')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /test connection/i }));
    expect(await screen.findByText(/Couldn't reach PriceCharting/)).toBeInTheDocument();
  });

  it('clears the key after confirming', async () => {
    const user = userEvent.setup();
    const m = mockApi({
      'GET /api/admin/users': users,
      'GET /api/admin/integrations': { pricecharting: { configured: true } },
      'DELETE /api/admin/integrations/pricecharting': { configured: false },
    });
    renderWithProviders(<AdminPage />);
    await user.click(screen.getByRole('radio', { name: 'Integrations' }));
    expect(await screen.findByText('Configured')).toBeInTheDocument();
    m.set('GET /api/admin/integrations', { pricecharting: { configured: false } });
    await user.click(screen.getByRole('button', { name: /clear key/i }));
    const confirmDialog = await screen.findByRole('dialog', { name: 'Clear the PriceCharting key?' });
    await user.click(within(confirmDialog).getByRole('button', { name: 'Clear key' }));
    await waitFor(() => expect(m.called('DELETE /api/admin/integrations/pricecharting')).toHaveLength(1));
    expect(await screen.findByText('Not set')).toBeInTheDocument();
  });

  it('hides "test connection" and "clear key" until a key is set', async () => {
    mockApi({
      'GET /api/admin/users': users,
      'GET /api/admin/integrations': { pricecharting: { configured: false } },
    });
    const user = userEvent.setup();
    renderWithProviders(<AdminPage />);
    await user.click(screen.getByRole('radio', { name: 'Integrations' }));
    await screen.findByText('Not set');
    expect(screen.getByRole('button', { name: /test connection/i })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /clear key/i })).not.toBeInTheDocument();
  });
});
