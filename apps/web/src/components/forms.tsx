import { useEffect, useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, X } from 'lucide-react';
import { useSubmit } from './formUtils';

export function Field({ label, hint, error, ...input }: { label: string; hint?: ReactNode; error?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <input id={id} className="input" aria-invalid={!!error || undefined} aria-describedby={hint || error ? `${id}-hint` : undefined} {...input} />
      {(error || hint) && (
        <p id={`${id}-hint`} className={`mt-1.5 text-xs ${error ? 'text-loss' : 'text-faint'}`}>
          {error || hint}
        </p>
      )}
    </div>
  );
}

export function FormError({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-lg border border-loss/30 bg-loss/10 px-3 py-2 text-sm text-loss">
      {error}
    </p>
  );
}

export function CopyField({ value, label = 'Link' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <input readOnly value={value} aria-label={label} className="input font-mono !text-xs" onFocus={(e) => e.currentTarget.select()} />
      <button
        type="button"
        className="btn btn-ghost shrink-0"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard blocked: the field is selectable */
          }
        }}
      >
        {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[80] grid place-items-center bg-onyx/45 p-4" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`w-full rounded-xl border border-line-strong bg-surface shadow-pop ${wide ? 'max-w-xl' : 'max-w-md'} p-6`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="font-display text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:text-fg" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Asks for the user's password before a sensitive action. */
export function PasswordPrompt({ title, action, danger, onConfirm, onClose, children }: {
  title: string;
  action: string;
  danger?: boolean;
  onConfirm: (password: string) => Promise<unknown>;
  onClose: () => void;
  children?: ReactNode;
}) {
  const [password, setPassword] = useState('');
  const { busy, error, onSubmit } = useSubmit(async () => {
    await onConfirm(password);
    onClose();
  });
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        {children}
        <Field label="Your password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus required />
        <FormError error={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy || !password}>
            {busy ? 'Working…' : action}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ConfirmDialog({ title, body, action, onConfirm, onClose }: {
  title: string;
  body: ReactNode;
  action: string;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}) {
  const { busy, error, onSubmit } = useSubmit(async () => {
    await onConfirm();
    onClose();
  });
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="text-sm text-muted">{body}</div>
        <FormError error={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-danger" disabled={busy} autoFocus>
            {busy ? 'Working…' : action}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function StatusPill({ tone, children }: { tone: 'good' | 'warn' | 'bad' | 'muted'; children: ReactNode }) {
  const cls = {
    good: 'border-gain/30 bg-gain/10 text-gain',
    warn: 'border-accent/30 bg-accent/10 text-accent',
    bad: 'border-loss/30 bg-loss/10 text-loss',
    muted: 'border-line bg-surface-2 text-muted',
  }[tone];
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>;
}
