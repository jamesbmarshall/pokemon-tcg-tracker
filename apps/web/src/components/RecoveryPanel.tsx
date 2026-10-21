import { useQuery } from '@tanstack/react-query';
import { getBackend } from '../api/backend';

const when = (value: string | null) => value ? new Date(value).toLocaleString() : 'Not reported';
export default function RecoveryPanel() {
  const query = useQuery({ queryKey: ['owner', 'diagnostics'], queryFn: () => getBackend().diagnostics?.() ?? Promise.resolve(null), refetchInterval: 60_000 });
  const data = query.data;
  if (!data) return <p className="text-sm text-muted">{query.isError ? 'Cannot verify backup protection. Check the server and host backup jobs.' : 'Backup protection has not been verified.'}</p>;
  const recovery = data.recovery;
  return <div className="space-y-3 text-sm">
    {data.storageWarning && <p role="status" className="text-muted">{data.storageWarning}</p>}
    <p role="status" className={recovery.state === 'current' ? 'text-gain' : 'text-loss'}>
      {recovery.state === 'current' ? 'Off-host recovery point is within the one-hour target.' : recovery.state === 'not_configured' ? 'No off-host backup has been reported. Configure host backups before relying on recovery.' : 'Backup protection needs attention. The one-hour recovery target may not be met.'}
    </p>
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
      <dt>Remote recovery point</dt><dd>{when(recovery.capturedAt)}</dd>
      <dt>Upload completed</dt><dd>{when(recovery.uploadedAt)}</dd>
      <dt>Repository checked</dt><dd>{when(recovery.checkedAt)}</dd>
      <dt>Restore verified</dt><dd>{when(recovery.verifiedAt)}</dd>
      <dt>Free storage</dt><dd>{data.storage ? `${(data.storage.availableBytes / 1073741824).toFixed(1)} GiB` : 'Unknown'}</dd>
      <dt>Ready to save</dt><dd>{data.ready ? 'Yes' : 'No - inspect server storage and shutdown state'}</dd>
      <dt>Build</dt><dd className="break-all font-mono text-xs">{data.build.version} · {data.build.commit ?? 'commit unavailable'}</dd>
      <dt>Image</dt><dd className="break-all font-mono text-xs">{data.build.image ?? 'Digest not supplied by host'}</dd>
      <dt>Schema / launcher</dt><dd>{data.build.schemaVersion} / {data.build.launcherVersion ?? 'Standalone'}</dd>
    </dl>
    {(recovery.verificationOverdue || recovery.verificationError) && <p className="text-loss">No recent successful restore verification is available. A completed upload alone does not prove recovery.</p>}
    {data.runtime.uid === 0 && <p className="text-loss">The server is running as root{data.runtime.rootOverride ? ' with an explicit host override' : ''}. Review the container user and volume ownership.</p>}
    <p className="text-xs text-muted">Optional host backup targets: a recovery point within one hour and restoration within two hours. These depend on separately configured backups and a successful restore rehearsal.</p>
    <a className="underline" href="https://github.com/jamesbmarshall/pokemon-tcg-tracker/blob/main/deploy/backup/README.md" target="_blank" rel="noreferrer">Host backup setup and verification</a>
  </div>;
}
