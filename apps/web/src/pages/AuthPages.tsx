import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { passwordProblem, USERNAME, USERNAME_HINT } from '@poketracker/shared/accounts';
import { api } from '../api/http';
import { useAuth } from '../store/authStore';
import { Logo } from '../components/ui';
import { Field, FormError } from '../components/forms';
import { useSubmit } from '../components/formUtils';

export function AuthShell({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-2.5">
          <Logo size={34} />
          <span className="font-display text-[22px] font-extrabold tracking-tight font-stretch-expanded">
            Poké<span className="holo-text">Tracker</span>
          </span>
        </div>
        <div className="panel p-6">
          <h1 className="font-display text-xl font-semibold">{title}</h1>
          {intro && <div className="mt-1.5 text-sm text-muted">{intro}</div>}
          <div className="mt-5">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** Username + display name + password + confirm, with the server's rules checked as you type. */
function useAccountForm(withUsername = true, fixedUsername = '') {
  const [username, setUsername] = useState(fixedUsername);
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const name = withUsername ? username.trim() : fixedUsername;
  const problems = {
    username: withUsername && touched && !USERNAME.test(name) ? USERNAME_HINT : undefined,
    password: touched ? passwordProblem(password, name) : undefined,
    confirm: touched && confirm !== password ? "Passwords don't match" : undefined,
  };
  const valid = (!withUsername || USERNAME.test(name)) && !passwordProblem(password, name) && confirm === password;
  const fields = (
    <>
      {withUsername && (
        <>
          <Field label="Username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} error={problems.username} hint="You sign in with this." required />
          <Field label="Display name" autoComplete="nickname" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={name || 'Ash'} hint="What other people on this server see. Optional." maxLength={60} />
        </>
      )}
      <Field label="Password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={problems.password} hint="At least 10 characters. A short sentence works well." required />
      <Field label="Confirm password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={problems.confirm} required />
    </>
  );
  return { fields, valid, touch: () => setTouched(true), values: { username: name, displayName: displayName.trim() || name, password } };
}

export function SetupPage() {
  const setup = useAuth((s) => s.setup);
  const [token, setToken] = useState('');
  const form = useAccountForm();
  const { busy, error, onSubmit } = useSubmit(async () => {
    form.touch();
    if (!form.valid) throw new Error('Fix the highlighted fields first');
    await setup({ token: token.trim(), ...form.values });
  });
  return (
    <AuthShell
      title="Set up your server"
      intro={
        <>
          Create the owner account. You'll need the one-time setup code from the server's logs. On Docker that's{' '}
          <code className="rounded bg-surface-2 px-1 font-mono text-xs text-fg">docker logs poketracker</code>; on Azure, open the app's log stream.
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Setup code" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} className="input font-mono" required autoFocus />
        {form.fields}
        <FormError error={error} />
        <button className="btn btn-primary w-full" disabled={busy || !token.trim()}>
          {busy ? 'Creating account…' : 'Create owner account'}
        </button>
      </form>
    </AuthShell>
  );
}

export function LoginPage() {
  const status = useAuth((s) => s.status);
  const login = useAuth((s) => s.login);
  const verifyMfa = useAuth((s) => s.verifyMfa);
  const signedOut = useAuth((s) => s.signedOut);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const signIn = useSubmit(() => login(username.trim(), password));
  const second = useSubmit(() => verifyMfa(code));

  if (status === 'mfa') {
    return (
      <AuthShell title="Two-factor check" intro="Enter the 6-digit code from your authenticator app, or one of your recovery codes.">
        <form onSubmit={second.onSubmit} className="space-y-4">
          <Field label="Code" inputMode="numeric" autoComplete="one-time-code" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} className="input font-mono tracking-widest" autoFocus required />
          <FormError error={second.error} />
          <button className="btn btn-primary w-full" disabled={second.busy || !code.trim()}>
            <ShieldCheck size={15} /> {second.busy ? 'Checking…' : 'Verify'}
          </button>
          <button type="button" className="w-full text-center text-xs text-muted hover:text-fg" onClick={() => { setCode(''); signedOut(); }}>
            Use a different account
          </button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Sign in">
      <form onSubmit={signIn.onSubmit} className="space-y-4">
        <Field label="Username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
        <Field label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <FormError error={signIn.error} />
        <button className="btn btn-primary w-full" disabled={signIn.busy || !username.trim() || !password}>
          <KeyRound size={15} /> {signIn.busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="text-center text-xs text-faint">Forgotten your password? Ask whoever runs this server for a reset link.</p>
      </form>
    </AuthShell>
  );
}

function SignedInNotice() {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  if (!user) return null;
  return (
    <div className="space-y-3 text-sm text-muted">
      <p>
        You're signed in as <b className="text-fg">{user.displayName}</b>. Sign out first to use this link for a different account.
      </p>
      <div className="flex gap-2">
        <button className="btn btn-ghost" onClick={() => void logout()}>
          Sign out
        </button>
        <Link to="/" className="btn btn-primary">
          Back to my collection
        </Link>
      </div>
    </div>
  );
}

function DeadLink({ title, children }: { title: string; children: ReactNode }) {
  return (
    <AuthShell title={title}>
      <p className="text-sm text-muted">{children}</p>
      <Link to="/" className="btn btn-ghost mt-5 w-full">
        Go to sign in
      </Link>
    </AuthShell>
  );
}

export function InvitePage() {
  const { token = '' } = useParams();
  const status = useAuth((s) => s.status);
  const acceptInvite = useAuth((s) => s.acceptInvite);
  const navigate = useNavigate();
  const form = useAccountForm();
  const invite = useQuery({ queryKey: ['invite', token], queryFn: () => api<{ valid: boolean; role?: string }>(`/api/invites/${encodeURIComponent(token)}`), retry: false });
  const { busy, error, onSubmit } = useSubmit(async () => {
    form.touch();
    if (!form.valid) throw new Error('Fix the highlighted fields first');
    await acceptInvite(token, form.values);
    navigate('/', { replace: true });
  });

  if (status === 'ready') return <AuthShell title="You've been invited">{<SignedInNotice />}</AuthShell>;
  if (invite.isPending) return <AuthShell title="Checking your invite…">{null}</AuthShell>;
  if (invite.isError || !invite.data?.valid)
    return <DeadLink title="This invite doesn't work">It may have expired or already been used. Ask the person who sent it for a new one.</DeadLink>;

  return (
    <AuthShell title="Create your account" intro={`You've been invited to this PokéTracker server${invite.data.role === 'admin' ? ' as an admin' : ''}. Pick a username and password.`}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {form.fields}
        <FormError error={error} />
        <button className="btn btn-primary w-full" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </AuthShell>
  );
}

export function ResetPage() {
  const { token = '' } = useParams();
  const status = useAuth((s) => s.status);
  const refreshUser = useAuth((s) => s.refreshUser);
  const navigate = useNavigate();
  const reset = useQuery({ queryKey: ['reset', token], queryFn: () => api<{ valid: boolean; username?: string }>(`/api/reset/${encodeURIComponent(token)}`), retry: false });
  const form = useAccountForm(false, reset.data?.username ?? '');
  const { busy, error, onSubmit } = useSubmit(async () => {
    form.touch();
    if (!form.valid) throw new Error('Fix the highlighted fields first');
    await api(`/api/reset/${encodeURIComponent(token)}`, { method: 'POST', body: { password: form.values.password } });
    await refreshUser();
    navigate('/', { replace: true });
  });

  if (status === 'ready') return <AuthShell title="Reset password">{<SignedInNotice />}</AuthShell>;
  if (reset.isPending) return <AuthShell title="Checking your link…">{null}</AuthShell>;
  if (reset.isError || !reset.data?.valid)
    return <DeadLink title="This reset link doesn't work">Reset links last 24 hours and work once. Ask an admin for a new one.</DeadLink>;

  return (
    <AuthShell title="Choose a new password" intro={<>For <b className="text-fg">{reset.data.username}</b>. This signs you out everywhere else.</>}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {form.fields}
        <FormError error={error} />
        <button className="btn btn-primary w-full" disabled={busy}>
          {busy ? 'Saving…' : 'Save password and sign in'}
        </button>
      </form>
    </AuthShell>
  );
}
