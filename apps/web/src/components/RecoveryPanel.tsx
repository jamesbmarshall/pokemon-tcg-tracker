import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/http';

interface BackupStatus {
  files: { name: string; kind: string; createdAt: string; size: number }[];
  error?: string | null;
  running: boolean; automatic: boolean; schedule: string; canRestore: boolean;
  sync: { available: boolean; enabled: boolean; copiedAt: string | null; error: string | null };
}
const when = (value: string) => new Date(value).toLocaleString();
export default function RecoveryPanel() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['owner', 'backup-packages'], queryFn: () => api<BackupStatus>('/api/admin/backup-packages'), refetchInterval: 15_000 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [restore, setRestore] = useState<{ name: string } | { file: File } | null>(null);
  const [confirmation, setConfirmation] = useState('');
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await action(); await qc.invalidateQueries({ queryKey: ['owner', 'backup-packages'] }); }
    catch (e) { setError(e instanceof Error ? e.message : 'The backup action failed. Please try again.'); }
    finally { setBusy(false); }
  }
  const data = query.data;
  return <div className="space-y-4 text-sm">
    <p>Backups include everyone’s collections, accounts, photos and app settings in one downloadable package. Keep downloaded packages private: they also contain the keys needed to recover your data.</p>
    {query.isPending ? <p>Loading backups…</p> : query.isError ? <p role="alert">Cannot load backups. Check your connection and try again. <button className="underline" onClick={() => void query.refetch()}>Retry</button></p> : data && <>
      <p role="status">{data.automatic ? `${data.schedule}. Keeps 14 daily, 3 monthly and 1 yearly backup; the same package can cover more than one period. Manual backups stay until removed by the server owner.` : 'Automatic backups are disabled on this server. Ask the server owner to enable scheduled jobs, or use Back up now.'}</p>
      {data.error && <p role="alert" className="text-loss">{data.error}</p>}
      <button className="btn btn-primary" disabled={busy || data.running} onClick={() => void run(async () => { await api('/api/admin/backup-packages', { method: 'POST' }); setMessage('Backup created. You can download it below.'); })}>{busy || data.running ? 'Working…' : 'Back up now'}</button>
      {!data.files.length ? <p>No complete backups yet. Create your first backup now.</p> : <ul className="divide-y divide-line rounded-xl border border-line">
        {data.files.map(f => <li key={f.name} className="flex flex-wrap items-center gap-3 p-3">
          <div className="flex-1"><p>{when(f.createdAt)}</p><p className="text-xs text-muted">{f.kind === 'before-restore' ? 'Saved before a restore' : f.kind === 'daily' ? 'Automatic' : 'Manual'} · {(f.size / 1048576).toFixed(1)} MB · Complete backup</p></div>
          <a className="btn btn-ghost" href={`/api/admin/backup-packages/${encodeURIComponent(f.name)}`} download>Download</a>
          {data.canRestore && <button className="btn btn-ghost" disabled={busy || data.running} aria-label={`Restore backup from ${when(f.createdAt)}`} onClick={() => { setRestore({ name: f.name }); setConfirmation(''); }}>Restore</button>}
        </li>)}
      </ul>}
      <div className="space-y-2 border-t border-line pt-3">
        <h3 className="font-semibold">Automatic copy to cloud storage</h3>
        <p>Copy backup packages to a folder connected to OneDrive, Google Drive or another storage service. The storage service syncs that folder to your account.</p>
        {data.sync.available ? <>
          <label className="flex items-center gap-2"><input type="checkbox" checked={data.sync.enabled} disabled={busy} onChange={e => { const enabled = e.target.checked; void run(async () => { await api('/api/admin/backup-packages/sync', { method: 'PUT', body: { enabled } }); }); }} />Copy new backups to the connected folder</label>
          <p className="text-muted">{data.sync.copiedAt ? `Last copied to the folder: ${when(data.sync.copiedAt)}. Check your storage service to confirm it has uploaded.` : 'No copy completed yet. After enabling, use Back up now to test the connection.'}</p>
          {data.sync.error && <p role="alert" className="text-loss">{data.sync.error}</p>}
        </> : <p className="text-muted">No folder is connected yet. The person hosting this app needs to connect a synced folder to the server. You can download a backup above and save it to your cloud drive at any time.</p>}
      </div>
      <div className="space-y-2 border-t border-line pt-3">
        <h3 className="font-semibold">Restore a downloaded backup</h3>
        {data.canRestore ? <><p>Choose a complete .tar.gz backup package (up to 10 GiB unpacked). We’ll check it, save a backup of your current data, then restart the app. You’ll sign in using the accounts and passwords from the restored backup.</p><label className="block">Choose backup package<input className="mt-2 block" type="file" accept=".tar.gz,application/gzip" disabled={busy || data.running} onChange={e => { const file = e.target.files?.[0]; if (file) { setRestore({ file }); setConfirmation(''); } e.target.value = ''; }} /></label></> : <p>This server cannot restart itself to restore a backup. Ask the person hosting it to use the complete-package restore instructions in the recovery guide included with the app.</p>}
      </div>
    </>}
    {restore && <div className="space-y-3 rounded-xl border border-line p-4" role="group" aria-label="Confirm backup restore">
      <h3 className="font-semibold">Replace all current data?</h3>
      <p>Changes made after this backup will be replaced for everyone. A complete backup of your current data will be saved first. The app will restart and sign everyone out.</p>
      <p className="break-all text-xs">{'name' in restore ? restore.name : restore.file.name}</p>
      <label className="block">Type RESTORE to continue<input className="input mt-2" value={confirmation} disabled={busy} onChange={e => setConfirmation(e.target.value)} /></label>
      <div className="flex gap-3"><button className="btn btn-danger" disabled={busy || confirmation !== 'RESTORE'} onClick={() => void run(async () => {
        let body: unknown;
        if ('name' in restore) body = { name: restore.name, confirm: 'RESTORE' };
        else { const form = new FormData(); form.append('package', restore.file); body = form; }
        await api('/api/admin/backup-packages/restore', { method: 'POST', body });
        setRestore(null); setMessage('Backup checked. The app is restarting. Reload this page in a moment and sign in with the restored account.');
      })}>Restore and restart</button><button className="btn btn-ghost" disabled={busy} onClick={() => setRestore(null)}>Cancel</button></div>
    </div>}
    {error && <p role="alert" className="text-loss">{error}</p>}
    {message && <p role="status">{message}</p>}
  </div>;
}
