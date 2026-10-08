/**
 * Admin console for owners and admins: users, invites, background jobs and storage, backups
 * (owner only) and the audit log.
 *
 * What each role may do is decided by the server; the checks here (canManage, owner-only tabs and
 * controls) just avoid offering actions that would be refused.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { Crown, Database, Download, Link2, Lock, Play, Plus, RefreshCw, Trash2, UserX } from 'lucide-react';
import { api } from '../api/http';
import { getBackend, type DeckSettings } from '../api/backend';
import { isAdmin, useAuth, type Role, type User } from '../store/authStore';
import { toast } from '../store/toastStore';
import { PageHeader, Segmented } from '../components/ui';
import { ConfirmDialog, CopyField, FormError, Modal, PasswordPrompt, StatusPill } from '../components/forms';
import { errorText, useSubmit } from '../components/formUtils';
import { bytes, formatDate, fromNow, relativeTime } from '../utils/format';

export interface AdminUser extends User {
  disabled: boolean;
  locked: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

interface Invite {
  id: string;
  role: Role;
  note: string | null;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  createdBy: string | null;
  usedBy: string | null;
}

export interface Job {
  name: string;
  label: string;
  running: boolean;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastStatus: 'ok' | 'error' | 'running' | 'interrupted' | null;
  lastError: string | null;
  nextRunAt: string | null;
}

interface Backup {
  name: string;
  size: number;
  createdAt: string;
  kind: 'daily' | 'manual' | 'pre-update';
}

interface AuditRow {
  at: string;
  action: string;
  target: string | null;
  ip: string | null;
  username: string | null;
}

const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };

// ---------------------------------------------------------------- users

/**
 * Mirrors the server's hierarchy: nobody manages themselves or the owner, and admins can only
 * manage members. Self-management is excluded so an admin can't lock themselves out by accident.
 */
function canManage(actor: User, target: AdminUser) {
  return actor.id !== target.id && target.role !== 'owner' && (actor.role === 'owner' || target.role === 'member');
}

function ResetLinkDialog({ target, onClose }: { target: AdminUser; onClose: () => void }) {
  const [clearTotp, setClearTotp] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const { busy, error, onSubmit } = useSubmit(async () => {
    // The link is only returned once; the server keeps a hash of the token, not the link itself.
    const r = await api<{ link: string }>(`/api/admin/users/${target.id}/reset`, { method: 'POST', body: { clearTotp } });
    setLink(r.link);
  });
  return (
    <Modal title={`Reset link for ${target.displayName}`} onClose={onClose} wide>
      {link ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">Send this to {target.displayName}. It works once, for 24 hours, and signs them out everywhere when used.</p>
          <CopyField value={link} />
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <p className="text-sm text-muted">Creates a one-time link that lets {target.displayName} choose a new password. Their current password keeps working until they use it.</p>
          {target.totpEnabled && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={clearTotp} onChange={(e) => setClearTotp(e.target.checked)} className="mt-1" />
              <span>
                Also turn off two-factor <span className="block text-xs text-faint">Only if they've lost their phone and recovery codes.</span>
              </span>
            </label>
          )}
          <FormError error={error} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={busy}>
              <Link2 size={15} /> Create link
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function UsersTab({ me }: { me: User }) {
  const qc = useQueryClient();
  const { data, isPending, error } = useQuery({ queryKey: ['admin', 'users'], queryFn: () => api<AdminUser[]>('/api/admin/users') });
  const [dialog, setDialog] = useState<{ kind: 'reset' | 'delete' | 'owner'; user: AdminUser } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'users'] });
  // Refetches even on failure, so the table never shows a change the server rejected.
  const patch = async (u: AdminUser, body: Record<string, unknown>, done: string) => {
    try {
      await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body });
      toast(done, { tone: 'success' });
    } catch (err) {
      toast(errorText(err), { tone: 'error' });
    }
    await refresh();
  };

  if (isPending) return <p className="text-sm text-muted">Loading…</p>;
  if (error) return <FormError error={errorText(error)} />;

  return (
    <>
      <div className="overflow-x-auto rounded-2xl border border-line">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs text-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">User</th>
              <th className="px-4 py-2.5 font-medium">Role</th>
              <th className="px-4 py-2.5 font-medium">Last sign-in</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data!.map((u) => {
              const manageable = canManage(me, u);
              return (
                <tr key={u.id} className={u.disabled ? 'opacity-60' : ''}>
                  <td className="px-4 py-3">
                    <p className="font-medium">
                      {u.displayName} {u.id === me.id && <span className="text-xs text-faint">(you)</span>}
                    </p>
                    <p className="flex flex-wrap items-center gap-1.5 font-mono text-xs text-faint">
                      {u.username}
                      {u.totpEnabled && <StatusPill tone="good">2FA</StatusPill>}
                      {u.disabled && <StatusPill tone="bad">Disabled</StatusPill>}
                      {u.locked && <StatusPill tone="warn">Locked out</StatusPill>}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    {me.role === 'owner' && manageable ? (
                      <select
                        aria-label={`Role for ${u.username}`}
                        className="input !h-8 !w-auto !py-0 text-xs"
                        value={u.role}
                        onChange={(e) => void patch(u, { role: e.target.value }, `${u.displayName} is now ${ROLE_LABEL[e.target.value as Role].toLowerCase()}`)}
                      >
                        <option value="admin">Admin</option>
                        <option value="member">Member</option>
                      </select>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs">
                        {u.role === 'owner' && <Crown size={12} className="text-accent" />}
                        {ROLE_LABEL[u.role]}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">{u.lastLoginAt ? relativeTime(u.lastLoginAt) : 'Never'}</td>
                  <td className="px-4 py-3">
                    {manageable && (
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {u.locked && (
                          <button className="btn btn-ghost !h-8 !px-2.5 text-xs" onClick={() => void patch(u, { unlock: true }, `${u.displayName} unlocked`)}>
                            <Lock size={13} /> Unlock
                          </button>
                        )}
                        <button className="btn btn-ghost !h-8 !px-2.5 text-xs" onClick={() => setDialog({ kind: 'reset', user: u })}>
                          <Link2 size={13} /> Reset link
                        </button>
                        <button className="btn btn-ghost !h-8 !px-2.5 text-xs" onClick={() => void patch(u, { disabled: !u.disabled }, u.disabled ? `${u.displayName} can sign in again` : `${u.displayName} is disabled and signed out`)}>
                          <UserX size={13} /> {u.disabled ? 'Enable' : 'Disable'}
                        </button>
                        {me.role === 'owner' && !u.disabled && (
                          <button className="btn btn-ghost !h-8 !px-2.5 text-xs" onClick={() => setDialog({ kind: 'owner', user: u })}>
                            <Crown size={13} /> Make owner
                          </button>
                        )}
                        <button className="btn btn-danger !h-8 !px-2.5 text-xs" aria-label={`Delete ${u.username}`} onClick={() => setDialog({ kind: 'delete', user: u })}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {dialog?.kind === 'reset' && <ResetLinkDialog target={dialog.user} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title={`Delete ${dialog.user.displayName}?`}
          action="Delete user"
          body={<>This permanently deletes their account, their personal collection and any shares they made. Shared collections they own are deleted too. Disable the account instead if you might want it back.</>}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await api(`/api/admin/users/${dialog.user.id}`, { method: 'DELETE' });
            toast(`${dialog.user.displayName} deleted`);
            await refresh();
          }}
        />
      )}
      {dialog?.kind === 'owner' && (
        <PasswordPrompt
          title={`Make ${dialog.user.displayName} the owner?`}
          action="Transfer ownership"
          danger
          onClose={() => setDialog(null)}
          onConfirm={async (password) => {
            await api(`/api/admin/users/${dialog.user.id}/transfer-ownership`, { method: 'POST', body: { password } });
            // The current user has just been demoted to admin; reload their role so owner-only UI goes away.
            await useAuth.getState().refreshUser();
            toast(`${dialog.user.displayName} is now the owner. You're an admin.`);
            await refresh();
          }}
        >
          <p className="text-sm text-muted">There's only one owner. They'll control updates, backups and ownership; you'll become an admin.</p>
        </PasswordPrompt>
      )}
    </>
  );
}

// ---------------------------------------------------------------- invites

// Precedence matters: a used invite reads as used even if it has since expired.
function inviteState(i: Invite): { tone: 'good' | 'warn' | 'bad' | 'muted'; label: string } {
  if (i.usedAt) return { tone: 'muted', label: `Used by ${i.usedBy ?? 'someone'}` };
  if (i.revokedAt) return { tone: 'bad', label: 'Revoked' };
  if (new Date(i.expiresAt).getTime() < Date.now()) return { tone: 'muted', label: 'Expired' };
  return { tone: 'good', label: `Open, expires ${fromNow(i.expiresAt)}` };
}

function InvitesTab({ me }: { me: User }) {
  const qc = useQueryClient();
  const { data, isPending } = useQuery({ queryKey: ['admin', 'invites'], queryFn: () => api<Invite[]>('/api/admin/invites') });
  // Only owners see the role picker, so admins always send 'member' (the server enforces the same).
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [days, setDays] = useState(7);
  const [note, setNote] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const create = useSubmit(async () => {
    const r = await api<{ link: string }>('/api/admin/invites', { method: 'POST', body: { role, days, note: note.trim() || undefined } });
    setLink(r.link);
    setNote('');
    await qc.invalidateQueries({ queryKey: ['admin', 'invites'] });
  });
  const revoke = async (id: string) => {
    await api(`/api/admin/invites/${id}`, { method: 'DELETE' }).catch((err) => toast(errorText(err), { tone: 'error' }));
    await qc.invalidateQueries({ queryKey: ['admin', 'invites'] });
  };

  return (
    <div className="space-y-6">
      <form onSubmit={create.onSubmit} className="panel space-y-4 p-5">
        <h3 className="font-semibold">Invite someone</h3>
        <p className="text-sm text-muted">Creates a single-use link. Whoever opens it picks their own username and password.</p>
        <div className="flex flex-wrap items-end gap-3">
          {me.role === 'owner' && (
            <div>
              <p className="mb-1.5 text-sm font-medium">Role</p>
              <Segmented<'member' | 'admin'> value={role} onChange={setRole} options={[{ value: 'member', label: 'Member' }, { value: 'admin', label: 'Admin' }]} />
            </div>
          )}
          <label className="text-sm font-medium">
            <span className="mb-1.5 block">Expires after</span>
            <select className="input !w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {[1, 3, 7, 14, 30].map((d) => (
                <option key={d} value={d}>
                  {d} day{d === 1 ? '' : 's'}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-48 flex-1 text-sm font-medium">
            <span className="mb-1.5 block">Note (optional)</span>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={100} placeholder="For Sam" />
          </label>
          <button className="btn btn-primary" disabled={create.busy}>
            <Plus size={15} /> Create invite link
          </button>
        </div>
        <FormError error={create.error} />
        {link && (
          <div className="space-y-2 rounded-xl border border-accent/30 bg-accent/5 p-3">
            <p className="text-xs text-muted">Copy this now. For security, it can't be shown again.</p>
            <CopyField value={link} label="Invite link" />
          </div>
        )}
      </form>

      {isPending ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : !data?.length ? (
        <p className="text-sm text-muted">No invites yet.</p>
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line">
          {data.map((i) => {
            const st = inviteState(i);
            const open = st.tone === 'good';
            return (
              <li key={i.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    {ROLE_LABEL[i.role]} invite{i.note && <span className="text-muted"> · {i.note}</span>}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-faint">
                    <StatusPill tone={st.tone}>{st.label}</StatusPill>
                    created {relativeTime(i.createdAt)}
                    {i.createdBy && ` by ${i.createdBy}`}
                  </p>
                </div>
                {open && (
                  <button className="btn btn-ghost !h-8 !px-3 text-xs" onClick={() => void revoke(i.id)}>
                    Revoke
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- jobs & storage

function JobsTab({ me }: { me: User }) {
  const qc = useQueryClient();
  // Poll quickly while something is running so the status pill updates, slowly otherwise.
  const jobs = useQuery({ queryKey: ['admin', 'jobs'], queryFn: () => api<Job[]>('/api/admin/jobs'), refetchInterval: (q) => (q.state.data?.some((j) => j.running) ? 2000 : 30000) });
  const storage = useQuery({ queryKey: ['admin', 'storage'], queryFn: () => api<{ dbBytes: number; images: { count: number; bytes: number; capBytes: number }; backups: number }>('/api/admin/storage') });
  const run = async (j: Job) => {
    try {
      await api(`/api/admin/jobs/${j.name}/run`, { method: 'POST' });
      toast(`${j.label} started`);
    } catch (err) {
      toast(errorText(err), { tone: 'error' });
    }
    await qc.invalidateQueries({ queryKey: ['admin', 'jobs'] });
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">These run on their own. "Run now" is only needed if you don't want to wait.</p>
      <ul className="divide-y divide-line rounded-2xl border border-line">
        {(jobs.data ?? []).map((j) => (
          <li key={j.name} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {j.label}
                {j.running ? (
                  <StatusPill tone="warn">Running</StatusPill>
                ) : j.lastStatus === 'error' ? (
                  <StatusPill tone="bad">Failed</StatusPill>
                ) : j.lastStatus === 'interrupted' ? (
                  <StatusPill tone="warn">Interrupted</StatusPill>
                ) : j.lastStatus === 'ok' ? (
                  <StatusPill tone="good">OK</StatusPill>
                ) : (
                  <StatusPill tone="muted">Not run yet</StatusPill>
                )}
              </p>
              <p className="mt-0.5 text-xs text-faint">
                {j.lastFinishedAt ? `Last run ${relativeTime(j.lastFinishedAt)}` : 'Never run'}
                {j.nextRunAt && ` · next ${fromNow(j.nextRunAt)}`}
              </p>
              {j.lastStatus === 'error' && j.lastError && <p className="mt-1 break-words font-mono text-[11px] text-loss">{j.lastError}</p>}
            </div>
            {/* Updates are owner-only, so admins can't trigger the update check by hand. */}
            {(j.name !== 'update-check' || me.role === 'owner') && (
              <button className="btn btn-ghost !h-8 !px-3 text-xs" disabled={j.running} onClick={() => void run(j)}>
                {j.running ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} />} Run now
              </button>
            )}
          </li>
        ))}
      </ul>

      {storage.data && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="panel p-4">
            <p className="eyebrow">Database</p>
            <p className="mt-1 font-display text-xl font-semibold tabular">{bytes(storage.data.dbBytes)}</p>
          </div>
          <div className="panel p-4">
            <p className="eyebrow">Image cache</p>
            <p className="mt-1 font-display text-xl font-semibold tabular">{bytes(storage.data.images.bytes)}</p>
            <p className="text-xs text-faint">
              {storage.data.images.count.toLocaleString('en-GB')} images · limit {bytes(storage.data.images.capBytes)}
            </p>
          </div>
          <div className="panel p-4">
            <p className="eyebrow">Backups</p>
            <p className="mt-1 font-display text-xl font-semibold tabular">{storage.data.backups}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- decks

function DecksTab() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['decks', 'settings'], queryFn: () => getBackend().getDeckSettings() });
  const [standard, setStandard] = useState('');
  const [expanded, setExpanded] = useState('');
  const [banned, setBanned] = useState('');
  // Seeds the form once the settings arrive, without re-seeding over the user's in-progress
  // edits on every refetch (e.g. after saving). Adjusting state during render rather than in an
  // effect avoids an extra render pass.
  const [seededFrom, setSeededFrom] = useState<DeckSettings | null>(null);
  if (data && data !== seededFrom) {
    setSeededFrom(data);
    setStandard(data.regulationMarks.standard.join(', '));
    setExpanded(data.regulationMarks.expanded.join(', '));
    setBanned(data.bannedCardIds.join('\n'));
  }

  const save = useSubmit(async () => {
    const regulationMarks = {
      standard: standard.split(',').map((s) => s.trim()).filter(Boolean),
      expanded: expanded.split(',').map((s) => s.trim()).filter(Boolean),
    };
    const bannedCardIds = banned.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    await getBackend().putDeckSettings({ regulationMarks, bannedCardIds });
    toast('Deck settings saved', { tone: 'success' });
    await qc.invalidateQueries({ queryKey: ['decks', 'settings'] });
  });

  if (!data) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <form onSubmit={save.onSubmit} className="panel space-y-4 p-5">
      <h3 className="font-semibold">Deck legality</h3>
      {/* Validation of exact formats (regulation-mark syntax, real card ids) happens server-side;
          this is just a convenience editor — the inputs here are intentionally simple
          (comma-separated / one-per-line text) rather than a fancy chip UI. */}
      <p className="text-sm text-muted">Controls which regulation marks and banned cards count as legal when checking decks.</p>
      <label className="block text-sm font-medium">
        <span className="mb-1.5 block">Standard regulation marks</span>
        <input className="input" value={standard} onChange={(e) => setStandard(e.target.value)} placeholder="H, I, J" />
      </label>
      <label className="block text-sm font-medium">
        <span className="mb-1.5 block">Expanded regulation marks</span>
        <input className="input" value={expanded} onChange={(e) => setExpanded(e.target.value)} placeholder="D, E, F, G, H, I, J" />
      </label>
      <label className="block text-sm font-medium">
        <span className="mb-1.5 block">Banned card ids (Expanded)</span>
        <textarea className="input min-h-32" value={banned} onChange={(e) => setBanned(e.target.value)} placeholder={'sv03-001\nsv04-002'} />
      </label>
      <FormError error={save.error} />
      <button className="btn btn-primary" disabled={save.busy}>
        Save
      </button>
    </form>
  );
}

// ---------------------------------------------------------------- backups (owner)

// Backups hold every user's data and password hashes, so the server limits them to the owner.

function BackupsTab() {
  const qc = useQueryClient();
  const { data, isPending } = useQuery({ queryKey: ['admin', 'backups'], queryFn: () => api<Backup[]>('/api/admin/backups') });
  const [doomed, setDoomed] = useState<Backup | null>(null);
  const create = useSubmit(async () => {
    const r = await api<{ name: string }>('/api/admin/backups', { method: 'POST' });
    toast(`Backup ${r.name} created`, { tone: 'success' });
    await qc.invalidateQueries({ queryKey: ['admin', 'backups'] });
  });
  const KIND = { daily: 'Nightly', manual: 'Manual', 'pre-update': 'Before update' } as const;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted">
          The server backs up everything nightly and before each update. Download one now and then and keep it somewhere else, in case the server's disk dies.
        </p>
        <button className="btn btn-primary" disabled={create.busy} onClick={() => void create.onSubmit()}>
          <Database size={15} /> {create.busy ? 'Backing up…' : 'Back up now'}
        </button>
      </div>
      <FormError error={create.error} />
      {isPending ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : !data?.length ? (
        <p className="text-sm text-muted">No backups yet. The first nightly backup runs tonight.</p>
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line">
          {data.map((b) => (
            <li key={b.name} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-xs">{b.name}</p>
                <p className="mt-0.5 text-xs text-faint">
                  {KIND[b.kind]} · {formatDate(b.createdAt)} ({relativeTime(b.createdAt)}) · {bytes(b.size)}
                </p>
              </div>
              {/* A plain link so the browser streams the file to disk; GETs need no CSRF header. */}
              <a className="btn btn-ghost !h-8 !px-3 text-xs" href={`/api/admin/backups/${encodeURIComponent(b.name)}`} download>
                <Download size={13} /> Download
              </a>
              <button className="btn btn-danger !h-8 !px-2.5 text-xs" aria-label={`Delete ${b.name}`} onClick={() => setDoomed(b)}>
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {doomed && (
        <ConfirmDialog
          title="Delete this backup?"
          action="Delete"
          body={<span className="font-mono text-xs">{doomed.name}</span>}
          onClose={() => setDoomed(null)}
          onConfirm={async () => {
            await api(`/api/admin/backups/${encodeURIComponent(doomed.name)}`, { method: 'DELETE' });
            await qc.invalidateQueries({ queryKey: ['admin', 'backups'] });
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- audit

// Friendly names for audit actions. Unknown actions fall back to the raw key, so a new server
// action shows up (less readably) without a web change.
const ACTION_LABEL: Record<string, string> = {
  'setup.owner_created': 'Server set up',
  'auth.login': 'Signed in',
  'auth.login_failed': 'Failed sign-in',
  'auth.mfa_failed': 'Wrong two-factor code',
  'account.password_changed': 'Changed password',
  'account.password_reset': 'Reset password with a link',
  'account.totp_enabled': 'Turned on two-factor',
  'account.totp_disabled': 'Turned off two-factor',
  'account.recovery_codes_regenerated': 'Made new recovery codes',
  'invite.created': 'Created an invite',
  'invite.revoked': 'Revoked an invite',
  'invite.accepted': 'Joined with an invite',
  'admin.user_updated': 'Changed a user',
  'admin.reset_link_created': 'Created a reset link',
  'admin.user_deleted': 'Deleted a user',
  'admin.ownership_transferred': 'Transferred ownership',
  'backup.created': 'Made a backup',
  'backup.downloaded': 'Downloaded a backup',
  'backup.deleted': 'Deleted a backup',
  'system.update_requested': 'Started an update',
  'system.rollback_requested': 'Rolled back',
  'system.update_applied': 'Installed an update',
  'system.settings': 'Changed update settings',
  'job.run': 'Ran a job',
  'collection.created': 'Created a shared collection',
  'collection.deleted': 'Deleted a shared collection',
  'collection.member_set': 'Changed who can use a collection',
  'collection.member_removed': 'Removed someone from a collection',
  'collection.cleared': 'Cleared a collection',
  'share.created': 'Shared something',
  'share.updated': 'Changed a share',
  'share.revoked': 'Stopped sharing',
  'share.deleted': 'Deleted a share',
};

function ActivityTab() {
  const { data, isPending } = useQuery({ queryKey: ['admin', 'audit'], queryFn: () => api<AuditRow[]>('/api/admin/audit') });
  if (isPending) return <p className="text-sm text-muted">Loading…</p>;
  if (!data?.length) return <p className="text-sm text-muted">Nothing yet.</p>;
  return (
    <div className="overflow-x-auto rounded-2xl border border-line">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-left text-xs text-muted">
          <tr>
            <th className="px-4 py-2.5 font-medium">When</th>
            <th className="px-4 py-2.5 font-medium">Who</th>
            <th className="px-4 py-2.5 font-medium">What</th>
            <th className="px-4 py-2.5 font-medium">IP</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {data.map((a, i) => (
            <tr key={i}>
              <td className="whitespace-nowrap px-4 py-2 text-xs text-muted" title={a.at}>
                {relativeTime(a.at)}
              </td>
              <td className="px-4 py-2 font-mono text-xs">{a.username ?? '—'}</td>
              <td className={`px-4 py-2 text-xs ${/failed/.test(a.action) ? 'text-loss' : ''}`}>
                {ACTION_LABEL[a.action] ?? a.action}
                {(a.action === 'job.run' || a.action === 'system.update_applied') && a.target && <span className="text-faint"> · {a.target}</span>}
              </td>
              <td className="px-4 py-2 font-mono text-xs text-faint">{a.ip ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- page

type Tab = 'users' | 'invites' | 'jobs' | 'decks' | 'backups' | 'activity';

export default function AdminPage() {
  const me = useAuth((s) => s.user);
  const [tab, setTab] = useState<Tab>('users');
  if (!me || !isAdmin(me)) return <Navigate to="/" replace />;
  const tabs: { value: Tab; label: string }[] = [
    { value: 'users', label: 'Users' },
    { value: 'invites', label: 'Invites' },
    { value: 'jobs', label: 'Jobs' },
    { value: 'decks', label: 'Decks' },
    ...(me.role === 'owner' ? [{ value: 'backups' as const, label: 'Backups' }] : []),
    { value: 'activity', label: 'Activity' },
  ];
  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader title="Admin">Manage who can use this server and keep an eye on what it's doing.</PageHeader>
      <div className="overflow-x-auto">
        <Segmented<Tab> value={tab} onChange={setTab} options={tabs} />
      </div>
      {tab === 'users' && <UsersTab me={me} />}
      {tab === 'invites' && <InvitesTab me={me} />}
      {tab === 'jobs' && <JobsTab me={me} />}
      {tab === 'decks' && <DecksTab />}
      {tab === 'backups' && <BackupsTab />}
      {tab === 'activity' && <ActivityTab />}
    </div>
  );
}
