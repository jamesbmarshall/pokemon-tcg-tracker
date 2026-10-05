import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AccountPage from './AccountPage';
import { describeAgent } from '../utils/format';
import { useAuth, type User } from '../store/authStore';
import { renderWithProviders } from '../test/render';
import { mockApi, reply } from '../test/apiMock';

const ash: User = { id: 'u1', username: 'ash', displayName: 'Ash', role: 'owner', totpEnabled: false };
const now = new Date().toISOString();
const sessions = [
  { id: 's1', current: true, createdAt: now, lastSeenAt: now, ip: '198.51.100.4', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15' },
  { id: 's2', current: false, createdAt: now, lastSeenAt: now, ip: '203.0.113.7', userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36' },
];

beforeEach(() => useAuth.setState({ status: 'ready', user: ash }));

it('updates the display name', async () => {
  const user = userEvent.setup();
  const m = mockApi({ 'GET /api/account/sessions': sessions, 'PATCH /api/account': { user: { ...ash, displayName: 'Ash K' } } });
  renderWithProviders(<AccountPage />);
  const save = screen.getByRole('button', { name: 'Save' });
  expect(save).toBeDisabled();
  await user.clear(screen.getByLabelText('Display name'));
  await user.type(screen.getByLabelText('Display name'), 'Ash K ');
  await user.click(save);
  await waitFor(() => expect(useAuth.getState().user?.displayName).toBe('Ash K'));
  expect(m.called('PATCH /api/account')[0].body).toEqual({ displayName: 'Ash K' });
});

describe('password', () => {
  it('checks the new password locally', async () => {
    const user = userEvent.setup();
    const m = mockApi({ 'GET /api/account/sessions': sessions });
    renderWithProviders(<AccountPage />);
    await user.type(screen.getByLabelText('Current password'), 'old one here');
    await user.type(screen.getByLabelText('New password'), 'short');
    expect(screen.getByText('Use at least 10 characters')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Confirm new password'), 'shorter');
    expect(screen.getByText("Passwords don't match")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(m.called('POST /api/account/password')).toHaveLength(0);
  });

  it('shows a wrong current password without signing out', async () => {
    const user = userEvent.setup();
    mockApi({ 'GET /api/account/sessions': sessions, 'POST /api/account/password': reply(400, { error: 'Your current password is wrong' }) });
    renderWithProviders(<AccountPage />);
    await user.type(screen.getByLabelText('Current password'), 'not it at all');
    await user.type(screen.getByLabelText('New password'), 'a much better one');
    await user.type(screen.getByLabelText('Confirm new password'), 'a much better one');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('current password is wrong');
    expect(useAuth.getState().status).toBe('ready');
  });

  it('changes it and clears the form', async () => {
    const user = userEvent.setup();
    const m = mockApi({ 'GET /api/account/sessions': sessions, 'POST /api/account/password': { ok: true } });
    renderWithProviders(<AccountPage />);
    await user.type(screen.getByLabelText('Current password'), 'the old password');
    await user.type(screen.getByLabelText('New password'), 'a much better one');
    await user.type(screen.getByLabelText('Confirm new password'), 'a much better one');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    await waitFor(() => expect(screen.getByLabelText('Current password')).toHaveValue(''));
    expect(m.called('POST /api/account/password')[0].body).toEqual({ current: 'the old password', next: 'a much better one' });
  });
});

describe('two-factor', () => {
  it('enrols, then shows recovery codes once', async () => {
    const user = userEvent.setup();
    const m = mockApi({
      'GET /api/account/sessions': sessions,
      'POST /api/account/totp/setup': { secret: 'JBSWY3DPEHPK3PXP', url: 'otpauth://totp/x', qr: '<svg xmlns="http://www.w3.org/2000/svg"/>' },
      'POST /api/account/totp/enable': { recoveryCodes: ['aaaa-bbbb', 'cccc-dddd'] },
    });
    renderWithProviders(<AccountPage />);
    await user.click(screen.getByRole('button', { name: /set up two-factor/i }));
    const qr = await screen.findByAltText('Two-factor QR code');
    expect(qr.getAttribute('src')).toMatch(/^data:image\/svg\+xml;utf8,%3Csvg/);
    expect(screen.getByLabelText('Secret key')).toHaveValue('JBSWY3DPEHPK3PXP');
    const turnOn = screen.getByRole('button', { name: 'Turn on' });
    await user.type(screen.getByLabelText('6-digit code'), '12345');
    expect(turnOn).toBeDisabled();
    await user.type(screen.getByLabelText('6-digit code'), '6');
    await user.click(turnOn);
    const dialog = await screen.findByRole('dialog', { name: 'Save your recovery codes' });
    expect(within(dialog).getByText('aaaa-bbbb')).toBeInTheDocument();
    expect(m.called('POST /api/account/totp/enable')[0].body).toEqual({ code: '123456' });
    expect(useAuth.getState().user?.totpEnabled).toBe(true);
    await user.click(within(dialog).getByRole('button', { name: "I've saved them" }));
    expect(screen.queryByText('aaaa-bbbb')).not.toBeInTheDocument();
    expect(screen.getByText('Two-factor sign-in is on.')).toBeInTheDocument();
  });

  it('turns off with the password', async () => {
    useAuth.setState({ user: { ...ash, totpEnabled: true } });
    const user = userEvent.setup();
    const m = mockApi({ 'GET /api/account/sessions': sessions, 'POST /api/account/totp/disable': { ok: true } });
    renderWithProviders(<AccountPage />);
    await user.click(screen.getByRole('button', { name: /turn off/i }));
    await user.type(screen.getByLabelText('Your password'), 'correct horse');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Turn off' }));
    await waitFor(() => expect(useAuth.getState().user?.totpEnabled).toBe(false));
    expect(m.called('POST /api/account/totp/disable')[0].body).toEqual({ password: 'correct horse' });
  });
});

it('lists devices and signs out another one', async () => {
  const user = userEvent.setup();
  const m = mockApi({ 'GET /api/account/sessions': sessions, 'DELETE /api/account/sessions/s2': {} });
  renderWithProviders(<AccountPage />);
  expect(await screen.findByText('Safari on macOS')).toBeInTheDocument();
  expect(screen.getByText('This device')).toBeInTheDocument();
  const android = screen.getByText('Chrome on Android').closest('li')!;
  await user.click(within(android).getByRole('button', { name: 'Sign out' }));
  await waitFor(() => expect(m.called('DELETE /api/account/sessions/s2')).toHaveLength(1));
});

it('signs out from the header', async () => {
  const user = userEvent.setup();
  mockApi({ 'GET /api/account/sessions': sessions, 'POST /api/auth/logout': {} });
  renderWithProviders(<AccountPage />);
  await user.click(screen.getAllByRole('button', { name: /sign out/i })[0]);
  await waitFor(() => expect(useAuth.getState().status).toBe('signed-out'));
});

it('describes user agents', () => {
  expect(describeAgent('')).toBe('Unknown device');
  expect(describeAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/125 Safari/537 Edg/125')).toBe('Edge on Windows');
  expect(describeAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17 Mobile Safari/604.1')).toBe('Safari on iOS');
  expect(describeAgent('Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Firefox/126.0')).toBe('Firefox on Linux');
  expect(describeAgent('curl/8.0')).toBe('Browser');
});
