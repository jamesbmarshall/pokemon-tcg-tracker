import { expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/render';
import { mockApi, reply } from '../test/apiMock';
import RecoveryPanel from './RecoveryPanel';
const status = {
  automatic: true, running: false, canRestore: true, schedule: 'Daily at 03:00 (server time)',
  sync: { available: false, enabled: false, copiedAt: null, error: null },
  files: [{ name: 'complete.tar.gz', kind: 'daily', createdAt: '2026-10-22T03:00:00Z', size: 1048576 }],
};
it('explains complete backups and retention, offers a download, and requires confirmation to restore', async () => {
  const user = userEvent.setup();
  const mock = mockApi({ 'GET /api/admin/backup-packages': status, 'POST /api/admin/backup-packages/restore': { restarting: true } });
  renderWithProviders(<RecoveryPanel />);
  expect(await screen.findByText(/Keeps 14 daily, 3 monthly and 1 yearly/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute('href', '/api/admin/backup-packages/complete.tar.gz');
  expect(screen.getByText(/No folder is connected/)).toBeInTheDocument();
  expect(screen.queryByText(/one-hour target/)).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /Restore backup from/ }));
  const confirm = screen.getByRole('button', { name: 'Restore and restart' });
  expect(confirm).toBeDisabled();
  await user.type(screen.getByLabelText('Type RESTORE to continue'), 'RESTORE');
  await user.click(confirm);
  await waitFor(() => expect(mock.called('POST /api/admin/backup-packages/restore')[0].body).toEqual({ name: 'complete.tar.gz', confirm: 'RESTORE' }));
  expect(await screen.findByText(/The app is restarting/)).toBeInTheDocument();
});
it('shows failures instead of reporting success and warns when scheduled backups are disabled', async () => {
  const user = userEvent.setup();
  mockApi({ 'GET /api/admin/backup-packages': { ...status, automatic: false }, 'POST /api/admin/backup-packages': reply(507, { error: 'Storage is full' }) });
  renderWithProviders(<RecoveryPanel />);
  expect(await screen.findByText(/Automatic backups are disabled/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Back up now' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Storage is full');
  expect(screen.queryByText('Backup created. You can download it below.')).not.toBeInTheDocument();
});
it('does not claim a folder copy proves a cloud upload', async () => {
  mockApi({ 'GET /api/admin/backup-packages': { ...status, sync: { available: true, enabled: true, copiedAt: '2026-10-22T03:00:00Z', error: 'Copy failed' } } });
  renderWithProviders(<RecoveryPanel />);
  expect(await screen.findByText(/Check your storage service to confirm it has uploaded/)).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Copy failed');
});
