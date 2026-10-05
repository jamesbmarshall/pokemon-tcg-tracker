import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UpdatesSection, { type UpdateInfo } from './UpdatesSection';
import { renderWithProviders } from '../test/render';
import { mockApi } from '../test/apiMock';

const info = (over: Partial<UpdateInfo> = {}): UpdateInfo => ({
  current: '1.2.0',
  launcherVersion: '1',
  canUpdate: true,
  blocker: null,
  autoUpdate: false,
  available: false,
  latest: null,
  checkedAt: new Date().toISOString(),
  error: null,
  applying: false,
  progress: null,
  launcher: { active: '1.2.0' },
  ...over,
});
const latest = { version: '1.3.0', name: 'PokéTracker 1.3', notes: 'Binder view for lists', url: 'https://github.com/jamesbmarshall/pokemon-tcg-tracker/releases/tag/v1.3.0', publishedAt: '2025-06-01T00:00:00Z' };

const reload = vi.fn();
const realLocation = window.location;
beforeEach(() => {
  reload.mockReset();
  Object.defineProperty(window, 'location', { configurable: true, value: { ...realLocation, reload } });
});
afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
});

it('says when it is up to date and checks on demand', async () => {
  const user = userEvent.setup();
  const m = mockApi({ 'GET /api/system/update': info(), 'POST /api/system/update/check': info({ available: true, latest }) });
  renderWithProviders(<UpdatesSection />);
  expect(await screen.findByText('Up to date')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /check now/i }));
  expect(await screen.findByText('Version 1.3.0 is available')).toBeInTheDocument();
  expect(screen.getByText('Binder view for lists')).toBeInTheDocument();
  expect(m.called('POST /api/system/update/check')).toHaveLength(1);
});

it('shows why it cannot update itself', async () => {
  mockApi({ 'GET /api/system/update': info({ canUpdate: false, available: true, latest, blocker: 'This version needs a newer container image. Pull the latest image and redeploy.' }) });
  renderWithProviders(<UpdatesSection />);
  expect(await screen.findByText(/needs a newer container image/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Update to 1.3.0' })).toBeDisabled();
  expect(screen.getByRole('checkbox', { name: /install updates automatically/i })).toBeDisabled();
});

it('shows progress while an update is being prepared', async () => {
  mockApi({ 'GET /api/system/update': info({ available: true, latest, applying: true, progress: 'Downloading' }) });
  renderWithProviders(<UpdatesSection />);
  expect(await screen.findByText('Downloading')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /update to/i })).not.toBeInTheDocument();
});

it('updates after confirming, waits for the restart and reloads', async () => {
  const user = userEvent.setup();
  let healthCalls = 0;
  const m = mockApi({
    'GET /api/system/update': info({ available: true, latest }),
    'POST /api/system/update/apply': {},
    'GET /health': () => ({ version: ++healthCalls < 2 ? '1.2.0' : '1.3.0' }),
  });
  renderWithProviders(<UpdatesSection />);
  await user.click(await screen.findByRole('button', { name: 'Update to 1.3.0' }));
  expect(screen.getByText(/goes back to\s+1\.2\.0 on its own/)).toBeInTheDocument();
  expect(m.called('POST /api/system/update/apply')).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: 'Update now' }));
  expect(await screen.findByText('Installing 1.3.0…')).toBeInTheDocument();
  await waitFor(() => expect(reload).toHaveBeenCalled(), { timeout: 6000 });
  expect(m.called('POST /api/system/update/apply')).toHaveLength(1);
}, 10_000);

it('toggles automatic updates', async () => {
  const user = userEvent.setup();
  const m = mockApi({ 'GET /api/system/update': info(), 'PUT /api/system/settings': info({ autoUpdate: true }) });
  renderWithProviders(<UpdatesSection />);
  const box = await screen.findByRole('checkbox', { name: /install updates automatically/i });
  await user.click(box);
  await waitFor(() => expect(box).toBeChecked());
  expect(m.called('PUT /api/system/settings')[0].body).toEqual({ autoUpdate: true });
});

describe('rollback', () => {
  it('offers to go back, and is clear the data is not rewound', async () => {
    const user = userEvent.setup();
    mockApi({ 'GET /api/system/update': info({ launcher: { active: '1.2.0', previous: '1.1.0' } }) });
    renderWithProviders(<UpdatesSection />);
    await user.click(await screen.findByRole('button', { name: 'Go back to 1.1.0' }));
    expect(screen.getByText(/collections and accounts stay as they are/)).toBeInTheDocument();
    expect(screen.getByText(/skip 1\.2\.0 until you install it again/)).toBeInTheDocument();
  });

  it('reports a version that failed to start and was undone', async () => {
    mockApi({
      'GET /api/system/update': info({
        launcher: { active: '1.2.0', previous: '1.3.0', last: { from: '1.2.0', to: '1.3.0', ok: false, rolledBack: true, restoredDb: true, at: new Date().toISOString(), message: 'Health check timed out', kind: 'update' } },
      }),
    });
    renderWithProviders(<UpdatesSection />);
    expect(await screen.findByText(/Version 1\.3\.0 didn't start/)).toBeInTheDocument();
    expect(screen.getByText(/went back to 1\.2\.0 on its own and restored the backup/)).toHaveTextContent('Health check timed out. Automatic updates will skip this version.');
  });

  it('reports a manual rollback', async () => {
    mockApi({ 'GET /api/system/update': info({ launcher: { active: '1.1.0', last: { from: '1.2.0', to: '1.1.0', ok: true, at: new Date().toISOString(), kind: 'rollback' } } }) });
    renderWithProviders(<UpdatesSection />);
    expect(await screen.findByText(/Went back from 1\.2\.0 to 1\.1\.0/)).toHaveTextContent('Automatic updates will skip that version.');
  });
});
