import { expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { getBackend, type SystemDiagnostics } from '../api/backend';
import { renderWithProviders } from '../test/render';
import RecoveryPanel from './RecoveryPanel';

it('does not confuse a current upload with verified restoration', async () => {
  getBackend().diagnostics = vi.fn().mockResolvedValue({
    ready: true, build: { version: 'test', commit: null, image: null, launcherVersion: '1.1.0', schemaVersion: 10, builtAt: null },
    runtime: { uid: 1000, gid: 1000, rootOverride: false }, storage: { availableBytes: 1073741824, totalBytes: 2147483648 },
    recovery: { configured: true, state: 'current', capturedAt: new Date().toISOString(), uploadedAt: new Date().toISOString(), checkedAt: null, verifiedAt: null, verificationOverdue: true, verificationError: null, error: null, snapshotRunning: false, targetRecoveryPointMinutes: 60, targetRestoreMinutes: 120 },
  } satisfies SystemDiagnostics);
  renderWithProviders(<RecoveryPanel />);
  expect(await screen.findByText('Off-host recovery point is within the one-hour target.')).toBeInTheDocument();
  expect(screen.getByText(/No recent successful restore verification/)).toBeInTheDocument();
  expect(screen.getByText('1.0 GiB')).toBeInTheDocument();
});
