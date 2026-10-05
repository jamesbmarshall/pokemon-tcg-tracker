/**
 * Admin "Updates" panel: shows the running version, checks for and applies updates, toggles
 * automatic updates, and rolls back. The update itself is done by the launcher process that
 * supervises the server; this UI asks the server to start it, then waits out the restart.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, CheckCircle2, ExternalLink, History, RefreshCw, TriangleAlert } from 'lucide-react';
import { api } from '../api/http';
import { ConfirmDialog, FormError, Modal, StatusPill } from './forms';
import { errorText } from './formUtils';
import { formatDate, relativeTime } from '../utils/format';

export interface UpdateInfo {
  current: string;
  /** Version of the supervising launcher; some updates require a minimum launcher version. */
  launcherVersion: string | null;
  canUpdate: boolean;
  /** Human-readable reason updates are unavailable (not under the launcher, or no signing key), shown as-is. */
  blocker: string | null;
  autoUpdate: boolean;
  available: boolean;
  latest: { version: string; name: string; notes: string; url: string; publishedAt: string } | null;
  checkedAt: string | null;
  error: string | null;
  applying: boolean;
  progress: string | null;
  /** What the launcher reports: active and previous installed versions and the outcome of the last switch. */
  launcher: {
    active?: string;
    previous?: string;
    last?: { from?: string; to?: string; ok: boolean; at: string; message?: string; rolledBack?: boolean; restoredDb?: boolean; kind?: 'update' | 'rollback' | 'image' };
  };
}

const KEY = ['system', 'update'];

/** Waits for the server to come back after a restart, then reports the version it's running. */
// Polls /health with plain fetch rather than api(): during the restart failures are expected and
// must not raise toasts or a sign-out. Returns null if the server hasn't answered after five minutes.
async function waitForRestart(from: string, signal: AbortSignal): Promise<string | null> {
  const deadline = Date.now() + 5 * 60_000;
  let sawDown = false;
  await new Promise((r) => setTimeout(r, 1500));
  while (Date.now() < deadline && !signal.aborted) {
    try {
      const res = await fetch('/health', { cache: 'no-store', signal });
      if (res.ok) {
        const { version } = (await res.json()) as { version: string };
        // The old process can answer for a moment before it exits; wait until it has gone or the version changed.
        if (version !== from || sawDown) return version;
      } else sawDown = true;
    } catch {
      sawDown = true;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

function LastResult({ last }: { last: NonNullable<UpdateInfo['launcher']['last']> }) {
  if (last.ok)
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <CheckCircle2 size={13} className="text-gain" />
        {last.kind === 'rollback' ? `Went back from ${last.from} to ${last.to}` : last.from ? `Updated from ${last.from} to ${last.to}` : `Started ${last.to}`} {relativeTime(last.at)}
        {last.kind === 'rollback' && '. Automatic updates will skip that version.'}
      </p>
    );
  return (
    <div className="rounded-xl border border-loss/30 bg-loss/5 p-3 text-xs">
      <p className="flex items-center gap-1.5 font-medium text-loss">
        <TriangleAlert size={13} /> {last.to ? `Version ${last.to} didn't start` : 'The last update failed'} ({relativeTime(last.at)})
      </p>
      <p className="mt-1 text-muted">
        {last.rolledBack ? `PokéTracker went back to ${last.from ?? 'the previous version'} on its own${last.restoredDb ? ' and restored the backup taken just before the update' : ''}. ` : ''}
        {last.message}. Automatic updates will skip this version.
      </p>
    </div>
  );
}

export default function UpdatesSection() {
  const qc = useQueryClient();
  const { data: info, error, isPending } = useQuery({
    queryKey: KEY,
    queryFn: () => api<UpdateInfo>('/api/system/update'),
    // Poll only while an update is being prepared, to show the launcher's progress messages.
    refetchInterval: (q) => (q.state.data?.applying ? 1500 : false),
  });
  const [checking, setChecking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'update' | 'rollback' | null>(null);
  const [restarting, setRestarting] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  // Stop polling for the restart if the user leaves the page.
  useEffect(() => () => abort.current?.abort(), []);

  const set = (next: UpdateInfo) => qc.setQueryData(KEY, next);

  const check = async () => {
    setChecking(true);
    setActionError(null);
    try {
      set(await api<UpdateInfo>('/api/system/update/check', { method: 'POST' }));
    } catch (err) {
      setActionError(errorText(err));
    } finally {
      setChecking(false);
    }
  };

  const restart = async (path: string, message: string) => {
    if (!info) return;
    await api(path, { method: 'POST' });
    setRestarting(message);
    abort.current = new AbortController();
    const version = await waitForRestart(info.current, abort.current.signal);
    if (version && version !== info.current) {
      // New code is running: load the new web app too.
      window.location.reload();
      return;
    }
    // Same version back (e.g. the update failed and the launcher rolled back) or no answer: stay on
    // the page and refetch so LastResult explains what happened.
    setRestarting(null);
    await qc.invalidateQueries({ queryKey: KEY });
    if (!version) setActionError("The server hasn't come back yet. Give it a minute, then refresh this page.");
  };

  if (isPending) return <p className="text-sm text-muted">Checking…</p>;
  if (error || !info) return <FormError error={errorText(error)} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-sm">
          Running <b className="font-mono">{info.current}</b>
        </p>
        {info.available && info.latest ? (
          <StatusPill tone="warn">Version {info.latest.version} is available</StatusPill>
        ) : info.checkedAt && !info.error ? (
          <StatusPill tone="good">Up to date</StatusPill>
        ) : null}
        <button className="btn btn-ghost !h-8 !px-3 text-xs" onClick={() => void check()} disabled={checking || info.applying}>
          <RefreshCw size={13} className={checking ? 'animate-spin' : ''} /> Check now
        </button>
      </div>
      <p className="text-xs text-faint">
        {info.checkedAt ? `Last checked ${relativeTime(info.checkedAt)}.` : 'Not checked yet.'} {info.error && <span className="text-loss">Last check failed: {info.error}</span>}
      </p>

      {info.launcher.last && <LastResult last={info.launcher.last} />}

      {info.blocker && (
        <p className="rounded-xl border border-line bg-surface-2 p-3 text-xs text-muted">
          <TriangleAlert size={13} className="mr-1 inline text-volt" />
          {info.blocker}
        </p>
      )}

      {info.available && info.latest && (
        <div className="panel space-y-3 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-semibold">{info.latest.name || `Version ${info.latest.version}`}</p>
            <a href={info.latest.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
              Released {formatDate(info.latest.publishedAt)} <ExternalLink size={11} />
            </a>
          </div>
          {info.latest.notes && <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-xl bg-surface-2 p-3 font-sans text-xs leading-relaxed text-muted">{info.latest.notes}</pre>}
          {info.applying ? (
            <p className="flex items-center gap-2 text-sm">
              <RefreshCw size={14} className="animate-spin" /> {info.progress ?? 'Preparing update…'}
            </p>
          ) : (
            <button className="btn btn-primary" disabled={!info.canUpdate || !!restarting} onClick={() => setConfirm('update')}>
              <ArrowDownToLine size={15} /> Update to {info.latest.version}
            </button>
          )}
        </div>
      )}

      <FormError error={actionError} />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line pt-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={info.autoUpdate}
            disabled={!info.canUpdate}
            onChange={async (e) => {
              try {
                set(await api<UpdateInfo>('/api/system/settings', { method: 'PUT', body: { autoUpdate: e.target.checked } }));
              } catch (err) {
                setActionError(errorText(err));
              }
            }}
          />
          Install updates automatically
          <span className="text-xs text-faint">(overnight, after a backup)</span>
        </label>
        {info.launcher.previous && info.canUpdate && (
          <button className="btn btn-ghost !h-8 !px-3 text-xs" onClick={() => setConfirm('rollback')} disabled={!!restarting || info.applying}>
            <History size={13} /> Go back to {info.launcher.previous}
          </button>
        )}
      </div>

      {confirm === 'update' && info.latest && (
        <ConfirmDialog
          title={`Update to ${info.latest.version}?`}
          action="Update now"
          body={
            <>
              PokéTracker backs up your data, installs the update and restarts. It's unavailable for about a minute. If the new version doesn't start, it goes back to{' '}
              {info.current} on its own.
            </>
          }
          onClose={() => setConfirm(null)}
          onConfirm={() => restart('/api/system/update/apply', `Installing ${info.latest!.version}…`)}
        />
      )}
      {confirm === 'rollback' && (
        <ConfirmDialog
          title={`Go back to ${info.launcher.previous}?`}
          action="Go back"
          body={<>PokéTracker restarts on the previous version. Your collections and accounts stay as they are. Automatic updates will skip {info.current} until you install it again by hand.</>}
          onClose={() => setConfirm(null)}
          onConfirm={() => restart('/api/system/update/rollback', `Going back to ${info.launcher.previous}…`)}
        />
      )}
      {restarting && (
        <Modal title="Restarting" onClose={() => undefined}>
          <p className="flex items-center gap-2 text-sm">
            <RefreshCw size={15} className="animate-spin" /> {restarting}
          </p>
          <p className="mt-2 text-xs text-muted">This page reloads by itself when PokéTracker is back. Don't close it.</p>
        </Modal>
      )}
    </div>
  );
}
