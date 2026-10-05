import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InvitePage, LoginPage, ResetPage, SetupPage } from './AuthPages';
import { useAuth, type User } from '../store/authStore';
import { renderWithProviders } from '../test/render';
import { mockApi, reply } from '../test/apiMock';

const ash: User = { id: 'u1', username: 'ash', displayName: 'Ash', role: 'owner', totpEnabled: false };
const brock: User = { id: 'u3', username: 'brock', displayName: 'Brock', role: 'member', totpEnabled: false };

beforeEach(() => {
  useAuth.setState({ status: 'signed-out', user: null, error: null });
});

async function fillAccount(user: ReturnType<typeof userEvent.setup>, opts: { username?: string; password?: string; confirm?: string } = {}) {
  const { username = 'brock', password = 'pewter city gym', confirm = password } = opts;
  await user.type(screen.getByLabelText('Username'), username);
  await user.type(screen.getByLabelText('Password'), password);
  await user.type(screen.getByLabelText('Confirm password'), confirm);
}

describe('LoginPage', () => {
  it('signs in with username and password', async () => {
    const user = userEvent.setup();
    const m = mockApi({ 'POST /api/auth/login': { user: ash }, 'GET /api/auth/me': { user: ash } });
    renderWithProviders(<LoginPage />);
    const submit = screen.getByRole('button', { name: /sign in/i });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText('Username'), ' ash ');
    await user.type(screen.getByLabelText('Password'), 'correct horse');
    await user.click(submit);
    await waitFor(() => expect(useAuth.getState().status).toBe('ready'));
    expect(m.called('POST /api/auth/login')[0].body).toEqual({ username: 'ash', password: 'correct horse' });
  });

  it('shows the server error on a bad password', async () => {
    const user = userEvent.setup();
    mockApi({ 'POST /api/auth/login': reply(401, { error: 'Wrong username or password' }) });
    renderWithProviders(<LoginPage />);
    await user.type(screen.getByLabelText('Username'), 'ash');
    await user.type(screen.getByLabelText('Password'), 'nope nope nope');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong username or password');
  });

  it('asks for a 2FA code, accepts a recovery code, and can go back', async () => {
    const user = userEvent.setup();
    const m = mockApi({
      'POST /api/auth/login': { mfa: true },
      'POST /api/auth/mfa': (body: unknown) => ((body as { code: string }).code === 'abcd-efgh' ? {} : reply(401, { error: "That code didn't work" })),
      'GET /api/auth/me': { user: ash },
    });
    renderWithProviders(<LoginPage />);
    await user.type(screen.getByLabelText('Username'), 'ash');
    await user.type(screen.getByLabelText('Password'), 'correct horse');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText('Two-factor check')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Code'), '000000');
    await user.click(screen.getByRole('button', { name: /verify/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent("didn't work");
    expect(useAuth.getState().status).toBe('mfa');

    await user.clear(screen.getByLabelText('Code'));
    await user.type(screen.getByLabelText('Code'), 'abcd-efgh');
    await user.click(screen.getByRole('button', { name: /verify/i }));
    await waitFor(() => expect(useAuth.getState().status).toBe('ready'));
    expect(m.called('POST /api/auth/mfa')).toHaveLength(2);
  });

  it('"Use a different account" returns to the password step', async () => {
    const user = userEvent.setup();
    useAuth.setState({ status: 'mfa' });
    renderWithProviders(<LoginPage />);
    await user.click(screen.getByRole('button', { name: /different account/i }));
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});

describe('SetupPage', () => {
  it('checks the account fields before calling the server', async () => {
    const user = userEvent.setup();
    const m = mockApi({});
    renderWithProviders(<SetupPage />);
    await user.type(screen.getByLabelText('Setup code'), 'ABCD-1234');
    await fillAccount(user, { username: 'x', password: 'short', confirm: 'other' });
    await user.click(screen.getByRole('button', { name: /create owner account/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Fix the highlighted fields');
    expect(screen.getByText(/Usernames are 2–32/)).toBeInTheDocument();
    expect(screen.getByText('Use at least 10 characters')).toBeInTheDocument();
    expect(screen.getByText("Passwords don't match")).toBeInTheDocument();
    expect(m.calls).toHaveLength(0);
  });

  it('rejects a password containing the username', async () => {
    const user = userEvent.setup();
    mockApi({});
    renderWithProviders(<SetupPage />);
    await user.type(screen.getByLabelText('Setup code'), 'ABCD-1234');
    await fillAccount(user, { username: 'ash', password: 'ash-ketchum-123' });
    await user.click(screen.getByRole('button', { name: /create owner account/i }));
    expect(await screen.findByText("Password can't contain your username")).toBeInTheDocument();
  });

  it('creates the owner and signs in', async () => {
    const user = userEvent.setup();
    const m = mockApi({ 'POST /api/setup': {}, 'GET /api/auth/me': { user: ash } });
    renderWithProviders(<SetupPage />);
    await user.type(screen.getByLabelText('Setup code'), '  ABCD-1234 ');
    await fillAccount(user, { username: 'ash', password: 'pallet town forever' });
    await user.click(screen.getByRole('button', { name: /create owner account/i }));
    await waitFor(() => expect(useAuth.getState().status).toBe('ready'));
    expect(m.called('POST /api/setup')[0].body).toEqual({ token: 'ABCD-1234', username: 'ash', displayName: 'ash', password: 'pallet town forever' });
  });

  it('shows a wrong setup code', async () => {
    const user = userEvent.setup();
    mockApi({ 'POST /api/setup': reply(403, { error: "That setup code isn't right" }) });
    renderWithProviders(<SetupPage />);
    await user.type(screen.getByLabelText('Setup code'), 'nope');
    await fillAccount(user, { username: 'ash', password: 'pallet town forever' });
    await user.click(screen.getByRole('button', { name: /create owner account/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent("setup code isn't right");
  });
});

describe('InvitePage', () => {
  const route = { route: '/invite/tok123', path: '/invite/:token' };

  it('explains a dead invite', async () => {
    mockApi({ 'GET /api/invites/tok123': reply(404, { error: 'Not found' }) });
    renderWithProviders(<InvitePage />, route);
    expect(await screen.findByText("This invite doesn't work")).toBeInTheDocument();
  });

  it('creates the account and lands on the collection', async () => {
    const user = userEvent.setup();
    const m = mockApi({ 'GET /api/invites/tok123': { valid: true, role: 'admin' }, 'POST /api/invites/tok123/accept': {}, 'GET /api/auth/me': { user: brock } });
    renderWithProviders(<InvitePage />, route);
    expect(await screen.findByText(/invited to this PokéTracker server as an admin/)).toBeInTheDocument();
    await fillAccount(user);
    await user.type(screen.getByLabelText('Display name'), 'Brock H');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(screen.getAllByTestId('location').at(-1)).toHaveTextContent(/^\/$/));
    expect(useAuth.getState().user).toEqual(brock);
    expect(m.called('POST /api/invites/tok123/accept')[0].body).toEqual({ username: 'brock', displayName: 'Brock H', password: 'pewter city gym' });
  });

  it('tells a signed-in user to sign out first', async () => {
    useAuth.setState({ status: 'ready', user: ash });
    mockApi({ 'GET /api/invites/tok123': { valid: true, role: 'member' } });
    renderWithProviders(<InvitePage />, route);
    expect(screen.getByText(/signed in as/)).toHaveTextContent('Ash');
  });
});

describe('ResetPage', () => {
  const route = { route: '/reset/r1', path: '/reset/:token' };

  it('explains an expired link', async () => {
    mockApi({ 'GET /api/reset/r1': { valid: false } });
    renderWithProviders(<ResetPage />, route);
    expect(await screen.findByText("This reset link doesn't work")).toBeInTheDocument();
  });

  it('sets a new password and signs in', async () => {
    const user = userEvent.setup();
    const m = mockApi({ 'GET /api/reset/r1': { valid: true, username: 'brock' }, 'POST /api/reset/r1': {}, 'GET /api/auth/me': { user: brock } });
    renderWithProviders(<ResetPage />, route);
    expect(await screen.findByText('brock')).toBeInTheDocument();
    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Password'), 'brock-rocks-hard');
    await user.type(screen.getByLabelText('Confirm password'), 'brock-rocks-hard');
    await user.click(screen.getByRole('button', { name: /save password/i }));
    expect(await screen.findByText("Password can't contain your username")).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Password'));
    await user.clear(screen.getByLabelText('Confirm password'));
    await user.type(screen.getByLabelText('Password'), 'onix and geodude');
    await user.type(screen.getByLabelText('Confirm password'), 'onix and geodude');
    await user.click(screen.getByRole('button', { name: /save password/i }));
    await waitFor(() => expect(useAuth.getState().status).toBe('ready'));
    expect(m.called('POST /api/reset/r1')[0].body).toEqual({ password: 'onix and geodude' });
  });
});
