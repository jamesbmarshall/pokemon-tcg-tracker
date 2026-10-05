/**
 * The signed-in user's own account: display name, password, two-factor sign-in and active
 * sessions. Password and two-factor changes ask for the password again, and the server checks it,
 * so a session left open on a shared computer can't be used to take over the account.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, LogOut, Monitor, ShieldCheck, ShieldOff } from 'lucide-react';
import { passwordProblem } from '@poketracker/shared/accounts';
import { api } from '../api/http';
import { useAuth, type User } from '../store/authStore';
import { toast } from '../store/toastStore';
import { PageHeader } from '../components/ui';
import { CopyField, Field, FormError, Modal, PasswordPrompt, StatusPill } from '../components/forms';
import { useSubmit } from '../components/formUtils';
import { describeAgent, relativeTime } from '../utils/format';

/** Two-column settings section (heading left, controls right), also used by the Admin page. */
export function Section({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 border-b border-line py-8 md:grid-cols-[260px_1fr]">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {description && <div className="mt-1 text-sm text-muted">{description}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

const ROLE_LABEL: Record<User['role'], string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };

function Profile({ user }: { user: User }) {
  const setUser = useAuth((s) => s.setUser);
  const [name, setName] = useState(user.displayName);
  const { busy, error, onSubmit } = useSubmit(async () => {
    const r = await api<{ user: User }>('/api/account', { method: 'PATCH', body: { displayName: name.trim() } });
    setUser(r.user);
    toast('Display name saved', { tone: 'success' });
  });
  return (
    <form onSubmit={onSubmit} className="max-w-sm space-y-4">
      <p className="text-sm text-muted">
        Signed in as <b className="font-mono text-fg">{user.username}</b> · <StatusPill tone="muted">{ROLE_LABEL[user.role]}</StatusPill>
      </p>
      <Field label="Display name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} hint="Shown to other people on this server, e.g. on shared collections." />
      <FormError error={error} />
      <button className="btn btn-ghost" disabled={busy || !name.trim() || name.trim() === user.displayName}>
        Save
      </button>
    </form>
  );
}

function ChangePassword({ user }: { user: User }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  // Same rules as the server (shared package), so most problems show before submitting.
  const problem = next ? passwordProblem(next, user.username) : undefined;
  const { busy, error, onSubmit } = useSubmit(async () => {
    if (problem) throw new Error(problem);
    if (next !== confirm) throw new Error("New passwords don't match");
    await api('/api/account/password', { method: 'POST', body: { current, next } });
    setCurrent('');
    setNext('');
    setConfirm('');
    toast('Password changed. Other devices have been signed out.', { tone: 'success' });
  });
  return (
    <form onSubmit={onSubmit} className="max-w-sm space-y-4">
      <Field label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      <Field label="New password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} error={problem} hint="At least 10 characters." required />
      <Field label="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={confirm && confirm !== next ? "Passwords don't match" : undefined} required />
      <FormError error={error} />
      <button className="btn btn-ghost" disabled={busy || !current || !next || !confirm}>
        {busy ? 'Saving…' : 'Change password'}
      </button>
    </form>
  );
}

// The server stores only hashes of recovery codes, so this is the one chance to see them.
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const text = codes.join('\n');
  return (
    <Modal title="Save your recovery codes" onClose={onDone} wide>
      <p className="text-sm text-muted">
        Each code signs you in once if you lose your phone. Keep them somewhere safe, like a password manager. You won't see them again.
      </p>
      <ul className="mt-4 grid grid-cols-2 gap-2 rounded-xl border border-line bg-surface-2 p-4 font-mono text-sm">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          className="btn btn-ghost"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([`PokéTracker recovery codes\n\n${text}\n`], { type: 'text/plain' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = 'poketracker-recovery-codes.txt';
            a.click();
            // Safe to revoke straight away: click() has already started the download.
            URL.revokeObjectURL(url);
          }}
        >
          <Download size={15} /> Download
        </button>
        <button className="btn btn-primary" onClick={onDone}>
          I've saved them
        </button>
      </div>
    </Modal>
  );
}

/**
 * Two-factor enrolment is two-step: setup returns a secret that the server holds as pending, and
 * 2FA is only switched on once the user proves their app works by entering a valid code. That
 * avoids locking someone out with a half-scanned QR code.
 */
function TwoFactor({ user }: { user: User }) {
  const setUser = useAuth((s) => s.setUser);
  const [enrol, setEnrol] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [prompt, setPrompt] = useState<'disable' | 'regen' | null>(null);
  const start = useSubmit(async () => setEnrol(await api('/api/account/totp/setup', { method: 'POST' })));
  const confirm = useSubmit(async () => {
    const r = await api<{ recoveryCodes: string[] }>('/api/account/totp/enable', { method: 'POST', body: { code: code.trim() } });
    setUser({ ...user, totpEnabled: true });
    setEnrol(null);
    setCode('');
    setCodes(r.recoveryCodes);
  });

  return (
    <div className="max-w-md">
      {user.totpEnabled ? (
        <div className="space-y-4">
          <p className="flex items-center gap-2 text-sm">
            <ShieldCheck size={16} className="text-gain" /> Two-factor sign-in is on.
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-ghost" onClick={() => setPrompt('regen')}>
              New recovery codes
            </button>
            <button className="btn btn-danger" onClick={() => setPrompt('disable')}>
              <ShieldOff size={15} /> Turn off
            </button>
          </div>
        </div>
      ) : enrol ? (
        <form onSubmit={confirm.onSubmit} className="space-y-4">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>Scan this with an authenticator app (1Password, Google Authenticator, Microsoft Authenticator…).</li>
            <li>Type the 6-digit code it shows.</li>
          </ol>
          {/* Loaded as an <img>, not inlined, so the server-generated SVG can't run script. */}
          <img src={`data:image/svg+xml;utf8,${encodeURIComponent(enrol.qr)}`} alt="Two-factor QR code" className="h-44 w-44 rounded-xl bg-white p-2" />
          <details className="text-xs text-muted">
            <summary className="cursor-pointer">Can't scan it?</summary>
            <p className="mt-2">Enter this key manually:</p>
            <div className="mt-1">
              <CopyField value={enrol.secret} label="Secret key" />
            </div>
          </details>
          <Field label="6-digit code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} className="input !w-40 font-mono tracking-widest" maxLength={6} required />
          <FormError error={confirm.error} />
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={confirm.busy || code.trim().length !== 6}>
              Turn on
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setEnrol(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted">Off. Turn it on so a leaked password isn't enough to get into your account.</p>
          <FormError error={start.error} />
          <button className="btn btn-primary" onClick={() => void start.onSubmit()} disabled={start.busy}>
            <ShieldCheck size={15} /> Set up two-factor
          </button>
        </div>
      )}

      {prompt === 'disable' && (
        <PasswordPrompt
          title="Turn off two-factor?"
          action="Turn off"
          danger
          onClose={() => setPrompt(null)}
          onConfirm={async (password) => {
            await api('/api/account/totp/disable', { method: 'POST', body: { password } });
            setUser({ ...user, totpEnabled: false });
            toast('Two-factor sign-in is off');
          }}
        >
          <p className="text-sm text-muted">Your recovery codes will stop working too.</p>
        </PasswordPrompt>
      )}
      {prompt === 'regen' && (
        <PasswordPrompt
          title="Make new recovery codes?"
          action="Make new codes"
          onClose={() => setPrompt(null)}
          onConfirm={async (password) => {
            const r = await api<{ recoveryCodes: string[] }>('/api/account/totp/recovery-codes', { method: 'POST', body: { password } });
            setCodes(r.recoveryCodes);
          }}
        >
          <p className="text-sm text-muted">Your old codes will stop working.</p>
        </PasswordPrompt>
      )}
      {codes && <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />}
    </div>
  );
}

interface SessionRow {
  id: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  ip: string;
  userAgent: string;
}

/** Every active session for this account. The current one can't be revoked here; use Sign out. */
function Sessions() {
  const qc = useQueryClient();
  const { data, isPending } = useQuery({ queryKey: ['account', 'sessions'], queryFn: () => api<SessionRow[]>('/api/account/sessions') });
  const revoke = async (id: string) => {
    try {
      await api(`/api/account/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await qc.invalidateQueries({ queryKey: ['account', 'sessions'] });
    } catch {
      toast("Couldn't sign that device out", { tone: 'error' });
    }
  };
  if (isPending) return <p className="text-sm text-muted">Loading…</p>;
  return (
    <ul className="divide-y divide-line rounded-2xl border border-line">
      {(data ?? []).map((s) => (
        <li key={s.id} className="flex items-center gap-3 px-4 py-3">
          <Monitor size={16} className="shrink-0 text-faint" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {describeAgent(s.userAgent)} {s.current && <StatusPill tone="good">This device</StatusPill>}
            </p>
            <p className="truncate text-xs text-faint">
              {s.ip || 'Unknown IP'} · active {relativeTime(s.lastSeenAt)} · signed in {relativeTime(s.createdAt)}
            </p>
          </div>
          {!s.current && (
            <button className="btn btn-ghost !h-8 !px-3 text-xs" onClick={() => void revoke(s.id)}>
              Sign out
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function AccountPage() {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  if (!user) return null;
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Account"
        actions={
          <button className="btn btn-ghost" onClick={() => void logout()}>
            <LogOut size={15} /> Sign out
          </button>
        }
      />
      <Section title="Profile">
        <Profile user={user} />
      </Section>
      <Section title="Password" description="Changing it signs you out on every other device.">
        <ChangePassword user={user} />
      </Section>
      <Section title="Two-factor sign-in" description="Ask for a code from your phone as well as your password.">
        <TwoFactor user={user} />
      </Section>
      <Section title="Signed-in devices" description="Sign out anywhere you don't recognise.">
        <Sessions />
      </Section>
    </div>
  );
}
